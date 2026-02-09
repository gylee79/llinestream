
# [최신] 비디오 처리, 보안 재생 및 오프라인 워크플로우

**목표:** 관리자가 비디오를 업로드하는 순간부터 최종 사용자가 온라인/오프라인에서 안전하게 시청하기까지의 전 과정을 자동화하고, 강력한 이중 암호화 및 워터마크 기술로 콘텐츠를 보호하는 서버리스 파이프라인입니다.

**기술 스택:**
- **AI 모델:** gemini-3-flash-preview
- **파일 암호화 (1차):** AES-256-GCM (파일 전체 암호화)
- **세션 키 암호화 (2차):** **HKDF-SHA256 (RFC 5869)** (사용자별 임시 키 생성)
- **실행 환경:** Firebase Cloud Functions (v2) / Cloud Run Jobs (전환 가능 구조)
- **데이터베이스:** Firestore
- **파일 저장소:** Firebase Storage
- **클라이언트:** React (Next.js), **Web Worker**, **Web Crypto API**
- **클라이언트 DB:** IndexedDB (오프라인 저장용)

---

## Part 1. 비디오 업로드 및 자동 처리 (관리자)

관리자가 비디오를 업로드하면, 아래 과정이 백그라운드에서 자동으로 진행됩니다.

1.  **메타데이터 입력 및 파일 선택 (`video-upload-dialog.tsx`)**
    관리자가 '비디오 업로드' 대화상자에서 제목, 설명, 강좌 분류 등을 입력하고 비디오 원본 파일, 썸네일 파일 등을 선택합니다.

2.  **파일 업로드 및 정보 저장 (`upload-episode.ts`)**
    `saveEpisodeMetadata` 서버 액션이 호출됩니다. 이 액션은 브라우저가 직접 Firebase Storage에 비디오와 썸네일 파일을 업로드하도록 지시합니다. 업로드가 완료되면 반환된 파일 경로와 URL, 그리고 입력된 모든 메타데이터를 Firestore의 `episodes` 컬렉션에 저장합니다. 이때 **`status.processing: 'pending'`** 상태로 저장되어 백엔드 프로세스를 깨웁니다.

3.  **백엔드 프로세스 트리거 (`functions/src/index.ts`)**
    Firestore에 `pending` 상태의 새 에피소드 문서가 생성되면, 이를 감지하는 Cloud Functions의 `onDocumentWritten` 트리거가 자동으로 실행됩니다. 함수는 즉시 상태를 `'processing'`으로 변경하여 중복 실행을 방지합니다.

4.  **AI 분석 및 암호화 병렬 처리 (`functions/src/index.ts`)**
    Cloud Function 내에서 두 가지 핵심 작업이 `Promise.allSettled`를 통해 동시에 시작됩니다.
    *   **작업 A: AI 콘텐츠 분석 (`runAiAnalysis`):**
        *   **기술:** gemini-3-flash-preview, Google AI File Manager
        *   **과정:** 원본 비디오 파일을 Google AI 서버에 업로드하고, "이 비디오를 분석하여 요약, 전체 대본, 시간대별 자막/설명이 포함된 타임라인을 한국어 JSON으로 만들어줘" 라고 구조화된 데이터 출력을 요청합니다.
        *   **결과:** AI가 생성한 결과물 중, 용량이 큰 **`transcript`(대본)는 별도의 `.txt` 파일**로, `timeline` 데이터는 **`.vtt` 자막 파일로 변환**하여 각각 Storage에 저장합니다. 대본을 제외한 나머지 분석 결과(요약, 타임라인 등)는 JSON 문자열 형태로 Firestore 문서의 `aiGeneratedContent` 필드에 저장됩니다.

    *   **작업 B: 파일 암호화 (`createEncryptedFile`) - 1차 암호화:**
        *   **기술:** Node.js `crypto` 모듈, AES-256-GCM
        *   **과정:**
            1. 비디오 파일 하나당 유일무이한 **`마스터 암호화 키`(AES-256)**와 암호화에 사용할 **`솔트(Salt)`**를 생성합니다.
            2. 암호화 시, 매번 새로운 **12바이트 `IV`(초기화 벡터)**를 무작위로 생성합니다.
            3. 마스터 키와 IV를 사용하여 원본 비디오 파일을 스트림 방식으로 완전히 암호화합니다.
            4. 최종 암호화 파일(`.lsv`)은 **`[IV(12바이트)][암호화된 비디오 데이터...][인증 태그(16바이트)]`** 구조를 가지며, 비공개 경로에 저장됩니다.
            5. 생성된 **마스터 키와 솔트는 절대로 `episodes` 문서에 저장하지 않고**, 서버에서만 접근 가능한 별도의 컬렉션인 **`video_keys`에 안전하게 보관**합니다.

5.  **최종 결과 저장 및 정리**
    두 작업이 모두 완료되면, AI 분석 결과 파일 경로(`transcriptPath`, `subtitlePath`), 암호화된 비디오 파일 경로(`storage.encryptedPath`) 및 메타데이터(`encryption` 객체)를 모두 Firestore의 해당 에피소드 문서에 업데이트하고 상태를 `'completed'`로 변경합니다. 마지막으로, 더 이상 필요 없는 원본 비디오 파일을 Storage에서 삭제하여 저장 공간을 절약하고 보안을 강화합니다.

---

## Part 2. 보안 온라인 스트리밍 (사용자)

사용자가 영상을 재생하면, 아래의 이중 암호화 해제 과정이 실시간으로 진행됩니다.

1.  **보안 URL 발급 요청 (`video-player-dialog.tsx` → `api/video-url`)**
    사용자가 재생 버튼을 누르면, 클라이언트는 서버의 `/api/video-url` 엔드포인트에 `videoId`와 **Firebase 인증 토큰**을 전송합니다. 서버는 사용자의 구독 권한을 확인한 후, 비공개 암호화 파일(`.lsv`)에 5분간 접근할 수 있는 **서명된 URL(Signed URL)**을 생성하여 클라이언트에 전달합니다.

2.  **재생 세션 및 임시 키 요청 (`video-player-dialog.tsx` → `api/play-session`)**
    URL을 받은 클라이언트는 즉시 서버의 `/api/play-session` 엔드포인트로 `videoId`와 `deviceId`를 전송하여 재생 세션을 시작하겠다고 요청합니다.

3.  **세션 키(Derived Key) 생성 (서버) - 2차 암호화**
    *   **기술:** Node.js `crypto.hkdf` (HKDF-SHA256 표준)
    *   **과정:** 서버는 요청을 받고 `video_keys` 비밀 금고에서 해당 비디오의 **'마스터 키'**와 **'솔트'**를 꺼냅니다. 그리고 **HKDF-SHA256 알고리즘**을 사용하여 **오직 이 사용자, 이 기기, 이 세션에서만 유효한 일회성 `세션 키(Derived Key)`**를 생성하여 클라이언트에 전달합니다.

4.  **실시간 복호화 및 재생 (클라이언트)**
    *   **기술:** **Web Worker**, **Web Crypto API (`crypto.subtle.decrypt`)**, Media Source Extensions (MSE)
    *   **과정:**
        1. 메인 스레드는 발급받은 서명된 URL을 통해 암호화된 `.lsv` 파일을 다운로드하고, 서버로부터 받은 `세션 키`와 함께 **Web Worker(백그라운드 스레드)로 전달**합니다.
        2. **Web Worker**는 전달받은 암호화된 비디오 파일의 헤더에서 **`IV`를 먼저 추출**하고, 나머지 부분(암호화된 데이터 + 인증 태그)을 가져옵니다.
        3. 세션 키와 추출된 IV를 사용하여 JavaScript Crypto API로 암호화된 데이터를 **실시간으로 풀면서(복호화)**, 복호화된 데이터 조각(chunk)을 다시 메인 스레드로 전송합니다. 이 과정은 UI를 전혀 방해하지 않습니다.
        4. 메인 스레드는 복호화된 데이터 조각을 `MediaSource` 버퍼에 주입하고, HTML5 `<video>` 요소는 버퍼에 주입된 데이터를 일반 비디오처럼 재생합니다.

---

## Part 3. 보안 오프라인 다운로드 및 재생 (사용자)

1.  **용량 확인 및 라이선스 요청 (`video-player-dialog.tsx` → `api/offline-license`)**
    사용자가 다운로드 버튼을 클릭하면, 클라이언트는 먼저 `navigator.storage.estimate()`를 사용해 기기의 잔여 저장 공간을 확인합니다. 공간이 충분하면, 서버의 `/api/offline-license` 엔드포인트로 `videoId`와 `deviceId`를 전송합니다.

2.  **오프라인 키 생성 (서버)**
    서버는 구독 권한을 확인하고 마스터 키와 솔트를 가져옵니다. 이번에는 **만료 시간(예: 7일 후)을 포함**하여 **HKDF-SHA256 알고리즘**으로 **오프라인용 세션 키**를 생성합니다.

3.  **라이선스 발급**
    서버는 생성된 `오프라인용 세션 키`, `만료 시간`, `워터마크 시드`를 포함한 **오프라인 라이선스**를 클라이언트에 전달합니다.

4.  **다운로드 및 저장 (클라이언트, `lib/offline-db.ts`)**
    클라이언트는 `/api/video-url`을 통해 서명된 URL을 받아, 암호화된 `.lsv` 파일 전체를 다운로드합니다. 다운로드한 **암호화된 비디오 데이터**와 **오프라인 라이선스**를 함께 브라우저의 `IndexedDB`에 안전하게 저장합니다.

5.  **오프라인 재생 (클라이언트, `downloads/page.tsx`)**
    사용자가 오프라인 상태에서 다운로드한 영상을 재생하면, 앱은 `IndexedDB`에서 암호화된 비디오와 오프라인 라이선스를 불러옵니다. 재생 전, 현재 시간이 라이선스에 저장된 `만료 시간`을 지났는지 확인합니다. 만료되지 않았다면, **Web Worker**가 저장된 `오프라인용 세션 키`를 사용하여 비디오 데이터를 실시간으로 복호화하며 재생합니다.

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
  "version": "3.1-HKDF-Worker",
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
          "description": "Files are uploaded to Storage and metadata saved to Firestore with 'pending' status.",
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
              "model": "gemini-3-flash-preview"
            },
            "fileEncryption": {
              "library": "Node.js Crypto",
              "algorithm": "AES-256-GCM",
              "keyManagement": "Master key is encrypted with a KEK from environment variables before being stored in 'video_keys'.",
              "lsvFileFormat": {
                "description": "The .lsv file is a concatenation of the IV, the ciphertext, and the GCM authentication tag.",
                "layout": "[IV][Ciphertext][AuthTag]",
                "ivLength": 12,
                "tagLength": 16,
                "tagPosition": "tail"
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
      "name": "Part 2: Encrypted Video Playback (Online)",
      "actor": "User",
      "steps": [
        {
          "step": 6,
          "description": "Client requests a short-lived signed URL for the encrypted file and a temporary session key.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "api": [
              "/api/video-url",
              "/api/play-session"
            ]
          }
        },
        {
          "step": 7,
          "description": "Server generates and returns a session-specific derived key using HKDF-SHA256.",
          "file": "src/app/api/play-session/route.ts",
          "technicalDetails": {
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
          "description": "The Web Worker decrypts the video chunks in the background and sends them back to the main thread for playback via Media Source Extensions.",
          "file": "src/workers/crypto.worker.ts",
          "technicalDetails": {
            "decryption": "Uses Web Crypto API (AES-GCM). The IV is extracted from the file header. The remainder of the buffer (ciphertext + auth tag) is passed to the decrypt function. The key is not extractable (`extractable: false`)."
          }
        }
      ]
    },
    {
      "name": "Part 3: Secure Offline Playback",
      "actor": "User",
      "steps": [
        {
          "step": 10,
          "description": "Client checks available storage and requests an offline license.",
          "file": "src/lib/offline-db.ts",
          "api": "/api/offline-license"
        },
        {
          "step": 11,
          "description": "Server generates a time-limited offline key using HKDF and returns it.",
          "file": "src/app/api/offline-license/route.ts",
          "technicalDetails": {
            "keyDerivation": "HKDF-SHA256(masterKey, salt, Buffer.concat([Buffer.from(\"LSV_OFFLINE_V1\"), ...]))"
          }
        },
        {
          "step": 12,
          "description": "Client downloads the encrypted video file and saves it along with the license to IndexedDB.",
          "file": "src/lib/offline-db.ts"
        },
        {
          "step": 13,
          "description": "For offline playback, the app checks license validity and uses the Web Worker to decrypt and play the local file.",
          "file": "src/components/shared/video-player-dialog.tsx"
        }
      ]
    }
  ]
}

    