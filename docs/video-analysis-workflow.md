
# [최종] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v4.0)

**목표:** 관리자가 비디오를 업로드하는 순간부터 최종 사용자가 온라인/오프라인에서 끊김 없이 안전하게 시청하기까지의 전 과정을 자동화합니다. KEK를 사용한 이중 키 암호화, Chunked 스트리밍, 동적 워터마크 기술로 콘텐츠를 보호하는 서버리스 파이프라인입니다.

**핵심 기술 스택:**
- **AI 모델:** gemini-3-flash-preview
- **마스터 키 암호화 (1차):** **KEK (Key Encryption Key)** - 환경변수 기반
- **파일 암호화 (2차):** **Chunked AES-256-GCM** (스트리밍 안정성)
- **세션 키 암호화 (3차):** **HKDF-SHA256 (RFC 5869)** (사용자별 임시 키 생성)
- **실행 환경:** Firebase Cloud Functions (v2)
- **데이터베이스:** Firestore
- **파일 저장소:** Firebase Storage
- **클라이언트:** React (Next.js), **Web Worker**, **Web Crypto API**, Media Source Extensions (MSE)
- **클라이언트 DB:** IndexedDB (오프라인 저장용)

---

## Part 1. 비디오 업로드 및 자동 처리 (관리자)

관리자가 비디오를 업로드하면, 아래 과정이 백그라운드에서 자동으로 진행됩니다.

1.  **메타데이터 입력 및 파일 선택 (`video-upload-dialog.tsx`)**
    관리자가 비디오 제목, 설명 등을 입력하고 원본 비디오 파일을 선택합니다.

2.  **파일 업로드 및 정보 저장 (`upload-episode.ts`)**
    브라우저가 직접 Firebase Storage에 비디오 파일을 업로드합니다. 업로드가 완료되면, 파일 경로와 메타데이터를 Firestore의 `episodes` 컬렉션에 **`status.processing: 'pending'`** 상태로 저장하여 백엔드 프로세스를 깨웁니다.

3.  **백엔드 프로세스 트리거 (`functions/src/index.ts`)**
    `pending` 상태의 새 에피소드 문서가 생성되면, Cloud Function의 `onDocumentWritten` 트리거가 실행됩니다. 함수는 즉시 상태를 `'processing'`으로 변경하여 중복 실행을 방지합니다.

4.  **AI 분석 및 암호화 병렬 처리 (`functions/src/index.ts`)**
    두 가지 핵심 작업이 `Promise.allSettled`를 통해 동시에 시작됩니다.
    *   **작업 A: AI 콘텐츠 분석 (`runAiAnalysis`):**
        *   **기술:** gemini-3-flash-preview
        *   **과정:** 원본 비디오 파일을 분석하여 요약, 전체 대본, 타임라인 등을 포함한 JSON 데이터를 생성합니다. 대본(`.txt`)과 자막(`.vtt`)은 별도 파일로 Storage에 저장하고, 나머지는 Firestore 문서의 `aiGeneratedContent` 필드에 저장합니다.
        *   **상태 분리:** 이 작업이 실패하더라도 비디오 암호화 및 재생에는 영향을 주지 않습니다. `aiProcessingStatus` 필드로 상태를 별도 관리합니다.

    *   **작업 B: 청크 기반 암호화 (`createEncryptedFile`)**
        *   **기술:** Node.js `crypto`, **Chunked AES-256-GCM**, **KEK**
        *   **과정:**
            1.  비디오 하나당 유일무이한 **`마스터 암호화 키`(AES-256)**와 **`솔트(Salt)`**를 생성합니다.
            2.  원본 비디오 파일을 **1MB 단위의 청크(chunk)로** 나누어 순차적으로 처리합니다.
            3.  **각 청크마다** 새로운 **12바이트 `IV`(초기화 벡터)**를 생성하고, 마스터 키를 사용해 청크를 암호화한 뒤 **16바이트 `인증 태그(Auth Tag)`**를 생성합니다.
            4.  암호화된 청크들을 **`[IV(12)][암호화된 데이터...][인증 태그(16)]`** 구조로 계속 이어 붙여 최종 암호화 파일(`.lsv`)을 완성합니다.
            5.  최종 파일을 비공개 경로(`episodes/{episodeId}/encrypted.lsv`)에 업로드합니다.
            6.  **(핵심 보안)** 생성된 **마스터 키**를 그대로 저장하지 않고, 서버 환경변수에만 존재하는 비밀 **`KEK(Key Encryption Key)`**를 사용하여 **한 번 더 암호화**합니다.
            7.  **'암호화된 마스터 키'**와 `솔트(Salt)`를 `video_keys` 컬렉션의 `vidkey_{episodeId}` 문서에 안전하게 보관합니다.

5.  **최종 결과 저장 및 정리**
    두 작업이 완료되면, AI 분석 결과 파일 경로, 암호화된 비디오 파일 경로 및 메타데이터(`encryption` 객체)를 모두 Firestore의 해당 에피소드 문서에 업데이트하고 상태를 `'completed'`로 변경합니다. 마지막으로, 원본 비디오 파일을 삭제하여 저장 공간을 절약하고 보안을 강화합니다.

---

## Part 2. 보안 온라인 스트리밍 (사용자)

사용자가 영상을 재생하면, 아래의 3중 암호화 해제 과정이 실시간으로 진행됩니다.

1.  **보안 URL 발급 요청 (`video-player-dialog.tsx` → `/api/video-url`)**
    클라이언트는 서버에 `videoId`와 인증 토큰을 보내 비공개 암호화 파일(`.lsv`)에 5분간 접근할 수 있는 **서명된 URL(Signed URL)**을 발급받습니다.

2.  **재생 세션 및 임시 키 요청 (`video-player-dialog.tsx` → `/api/play-session`)**
    URL을 받은 클라이언트는 서버에 `videoId`와 `deviceId`를 보내 재생 세션을 요청합니다.

3.  **세션 키(Derived Key) 생성 (서버, `/api/play-session/route.ts`)**
    *   **기술:** **KEK**, Node.js `crypto.hkdf` (**HKDF-SHA256**)
    *   **과정:**
        1.  서버는 `video_keys` 금고에서 해당 비디오의 **'암호화된 마스터 키'**를 꺼냅니다.
        2.  환경변수의 **KEK**를 사용하여 '암호화된 마스터 키'의 암호를 풀어 **원본 마스터 키를 메모리 상에서만 복원**합니다.
        3.  복원된 마스터 키, 솔트(salt), 그리고 표준화된 `info` 값을 **HKDF-SHA256 알고리즘**에 입력하여 **오직 이 세션에서만 유효한 일회성 `세션 키(Derived Key)`**를 생성합니다.
            *   **표준 `info` 구조:** `Buffer.concat([Buffer.from("LSV_ONLINE_V1"), ...])`
        4.  생성된 세션 키를 클라이언트에 전달합니다.

4.  **실시간 청크 단위 복호화 및 재생 (클라이언트, `crypto.worker.ts`)**
    *   **기술:** **Web Worker**, **Web Crypto API (`crypto.subtle.decrypt`)**, Media Source Extensions (MSE)
    *   **과정:**
        1.  메인 스레드는 발급받은 서명된 URL과 세션 키를 **Web Worker(백그라운드 스레드)로 전달**합니다.
        2.  Web Worker는 `.lsv` 파일을 **청크 단위로 순차 처리**합니다.
        3.  각 청크마다 헤더에서 **`IV`를 먼저 추출**하고, 나머지 부분(**암호화된 데이터 + 인증 태그**)을 가져옵니다.
        4.  Web Crypto API를 사용하여 세션 키와 IV로 해당 청크의 암호를 풀고, 복호화된 데이터 조각을 다시 메인 스레드로 전송합니다.
        5.  메인 스레드는 복호화된 데이터 조각을 `MediaSource` 버퍼에 순서대로 주입하고, HTML5 `<video>` 요소는 버퍼에 주입된 데이터를 일반 비디오처럼 재생합니다. 이 방식 덕분에 전체 파일 다운로드 없이 즉시 재생이 시작되고, 네트워크가 불안정해도 안정적인 시청이 가능합니다.

---

## Part 3. 보안 오프라인 다운로드 및 재생 (사용자)

1.  **용량 확인 및 라이선스 요청 (`lib/offline-db.ts` → `/api/offline-license`)**
    사용자가 다운로드 버튼을 클릭하면, 클라이언트는 먼저 `navigator.storage.estimate()`를 사용해 기기의 잔여 저장 공간을 확인합니다. 공간이 충분하면, 서버에 `videoId`와 `deviceId`를 전송하여 오프라인 라이선스를 요청합니다.

2.  **오프라인 키 생성 (서버, `/api/offline-license/route.ts`)**
    서버는 구독 권한을 확인하고, 온라인 재생과 동일한 방식으로 KEK를 사용해 마스터 키를 복원합니다. 이번에는 **만료 시간(예: 7일 후)을 포함**하고 **`LSV_OFFLINE_V1`** 접두사를 사용한 표준 `info` 값으로 **HKDF 알고리즘**을 실행하여 **오프라인용 세션 키**를 생성합니다.

3.  **라이선스 발급 및 저장 (`lib/offline-db.ts`)**
    서버는 `오프라인용 세션 키`, `만료 시간`, `워터마크 시드`를 포함한 **오프라인 라이선스**를 클라이언트에 전달합니다. 클라이언트는 암호화된 `.lsv` 파일 전체와 이 라이선스를 함께 브라우저의 `IndexedDB`에 안전하게 저장합니다.

4.  **오프라인 재생 (`downloads/page.tsx` & `video-player-dialog.tsx`)**
    사용자가 오프라인 상태에서 다운로드한 영상을 재생하면, 앱은 `IndexedDB`에서 암호화된 비디오와 라이선스를 불러옵니다. 라이선스의 `만료 시간`을 확인한 후, **Web Worker**가 저장된 `오프라인용 세션 키`를 사용하여 비디오 데이터를 **청크 단위로 실시간 복호화**하며 재생합니다.

---

## Part 4. 워터마크 처리 방식

*   **시드 생성:** 온라인/오프라인 키를 발급할 때, 서버는 `사용자 ID`를 해싱하여 고유한 **`워터마크 시드`** 문자열을 생성하여 키와 함께 전달합니다.
*   **동적 렌더링 (`video-player-dialog.tsx`):** 비디오 플레이어는 전달받은 `워터마크 시드`를 비디오 위에 여러 개 복제하여 희미하게, 그리고 불규칙하게 움직이는 오버레이로 표시합니다.
*   **목적:** 화면 녹화를 하더라도 누가 녹화했는지 식별할 수 있는 흔적을 남겨 콘텐츠를 보호합니다.

---
---

## 워크플로우 요약 (JSON)

```json
{
  "workflow": "LlineStream Video Processing & Playback",
  "version": "4.0-Chunked-KEK-HKDF",
  "parts": [
    {
      "name": "Part 1: Video Upload & Backend Processing",
      "actor": "Admin",
      "steps": [
        {
          "step": 1,
          "description": "Admin inputs metadata and selects files in the UI.",
          "file": "src/components/admin/content/video-upload-dialog.tsx"
        },
        {
          "step": 2,
          "description": "Files are uploaded to Storage; metadata saved to Firestore with 'pending' status.",
          "file": "src/lib/actions/upload-episode.ts"
        },
        {
          "step": 3,
          "description": "Cloud Function is triggered by the new Firestore document and sets status to 'processing'.",
          "file": "functions/src/index.ts"
        },
        {
          "step": 4,
          "description": "AI analysis and file encryption run in parallel.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "aiAnalysis": {
              "model": "gemini-3-flash-preview",
              "statusField": "aiProcessingStatus"
            },
            "fileEncryption": {
              "library": "Node.js Crypto",
              "algorithm": "AES-256-GCM-CHUNKED",
              "chunkSize": "1MB",
              "lsvChunkFormat": {
                "description": "The .lsv file is a concatenation of encrypted chunks.",
                "layout": "[IV(12)][Ciphertext(1MB)][AuthTag(16)]...repeat"
              },
              "keyManagement": {
                "level_1": "A unique Master Key is generated per video.",
                "level_2": "The Master Key is encrypted using a KEK from environment variables before being stored in 'video_keys'."
              }
            }
          }
        },
        {
          "step": 5,
          "description": "Results (paths, metadata) are saved to the episode document, status is set to 'completed', and original file is deleted.",
          "file": "functions/src/index.ts"
        }
      ]
    },
    {
      "name": "Part 2: Encrypted Video Playback (Online/Offline)",
      "actor": "User",
      "steps": [
        {
          "step": 6,
          "description": "Client requests a short-lived signed URL and a temporary session key.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "api": ["/api/video-url", "/api/play-session", "/api/offline-license"]
        },
        {
          "step": 7,
          "description": "Server decrypts the master key using KEK, then generates and returns a session-specific derived key using standardized HKDF.",
          "file": "src/app/api/play-session/route.ts",
          "technicalDetails": {
            "masterKeyDecryption": "Uses KEK from process.env to decrypt 'encryptedMasterKey' from 'video_keys'.",
            "keyDerivation": "HKDF-SHA256(masterKey, salt, Buffer.concat([Buffer.from(\"LSV_ONLINE_V1\"), ...]))"
          }
        },
        {
          "step": 8,
          "description": "A Web Worker receives the encrypted data and the derived key.",
          "file": "src/components/shared/video-player-dialog.tsx"
        },
        {
          "step": 9,
          "description": "The Web Worker decrypts the video chunk by chunk and sends them back to the main thread for playback via Media Source Extensions.",
          "file": "src/workers/crypto.worker.ts",
          "technicalDetails": {
            "decryption": "Uses Web Crypto API (AES-GCM). It processes the stream chunk by chunk, extracting IV and Ciphertext+AuthTag from each block to decrypt it independently."
          }
        }
      ]
    }
  ]
}
```
