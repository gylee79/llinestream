
# [최종] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v5.0)

**목표:** 관리자가 비디오를 업로드하는 순간부터 최종 사용자가 온라인/오프라인에서 끊김 없이 안전하게 시청하기까지의 전 과정을 자동화합니다. **안정성이 대폭 향상된 Chunked 스트리밍**과 동적 워터마크 기술로 콘텐츠를 보호하는 서버리스 파이프라인입니다.

**핵심 기술 스택 (v5.0 기준):**
- **AI 모델:** `gemini-1.5-flash-preview`
- **파일 암호화:** **Chunked AES-256-GCM with Length Header** (스트리밍 안정성 극대화)
- **마스터 키 암호화:** 환경변수/Secret Manager 기반 **KEK(Key Encryption Key)**
- **세션 키 암호화:** **HKDF-SHA256 (RFC 5869)** (표준화된 `info` 값 사용)
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
        *   **기술:** `gemini-1.5-flash-preview`
        *   **과정:** 원본 비디오 파일을 분석하여 요약, 전체 대본, 타임라인 등을 포함한 JSON 데이터를 생성합니다. 대본(`.txt`)과 자막(`.vtt`)은 별도 파일로 Storage에 저장하고, 나머지는 Firestore 문서의 `aiGeneratedContent` 필드에 저장합니다.
        *   **상태 분리:** 이 작업이 실패하더라도 비디오 암호화 및 재생에는 영향을 주지 않습니다. `aiProcessingStatus` 필드로 상태를 별도 관리하며, 관리자 페이지에서 재시도할 수 있습니다.

    *   **작업 B: 청크 기반 암호화 (`createEncryptedFile`)**
        *   **기술:** Node.js `crypto`, **Chunked AES-256-GCM-V3 (with Length Header)**
        *   **과정:**
            1. 환경변수 또는 Secret Manager에서 **KEK(Key Encryption Key)**를 안전하게 로드합니다.
            2. 비디오 하나당 유일무이한 **`마스터 암호화 키`(AES-256)**와 **`솔트(Salt)`**를 생성합니다.
            3. 원본 비디오 파일을 **1MB 단위의 청크(chunk)로** 나누어 순차적으로 처리합니다.
            4. **각 청크마다** 새로운 **12바이트 `IV`(초기화 벡터)**를 생성하고, 마스터 키를 사용해 청크를 암호화한 뒤 **16바이트 `인증 태그(Auth Tag)`**를 생성합니다. 또한 청크의 순서 재조합 공격을 막기 위해 청크 인덱스를 AAD(Additional Authenticated Data)로 사용합니다.
            5. **[v5.0 핵심]** 암호화된 각 청크 앞에, **청크의 전체 길이(IV+데이터+Tag)를 나타내는 4바이트 헤더**를 추가합니다.
            6. 최종적으로 **`[길이(4)][IV(12)][암호화된 데이터...][인증 태그(16)]`** 구조의 청크들을 계속 이어 붙여 최종 암호화 파일(`.lsv`)을 완성합니다.
            7. 최종 파일을 비공개 경로(`episodes/{episodeId}/encrypted.lsv`)에 업로드합니다.
            8. 생성된 **마스터 키**를 **KEK로 다시 암호화**하여 `video_keys` 컬렉션의 `vidkey_{episodeId}` 문서에 `encryptedMasterKey` 필드로 안전하게 보관합니다. 이 컬렉션은 서버만 접근 가능합니다.

5.  **최종 결과 저장 및 정리**
    두 작업이 완료되면, AI 분석 결과 파일 경로, 암호화된 비디오 파일 경로 및 메타데이터(`encryption.version: 3`)를 모두 Firestore의 해당 에피소드 문서에 업데이트하고 상태를 `'completed'`로 변경합니다. 마지막으로, 원본 비디오 파일을 삭제하여 저장 공간을 절약하고 보안을 강화합니다.

---

## Part 2. 보안 온라인 스트리밍 (사용자)

1.  **보안 URL 발급 요청 (`video-player-dialog.tsx` → `/api/video-url`)**
    클라이언트는 서버에 `videoId`와 인증 토큰을 보내 비공개 암호화 파일(`.lsv`)에 5분간 접근할 수 있는 **서명된 URL(Signed URL)**을 발급받습니다.

2.  **재생 세션 및 임시 키 요청 (`video-player-dialog.tsx` → `/api/play-session`)**
    클라이언트는 서버에 `videoId`와 `deviceId`를 보내 재생 세션을 요청합니다. 응답에는 **세션 키의 만료 시간**이 포함됩니다.

3.  **세션 키(Derived Key) 생성 (서버, `/api/play-session/route.ts`)**
    *   **기술:** Node.js `crypto.hkdf` (**HKDF-SHA256**)
    *   **과정:**
        1. 서버는 `video_keys` 금고에서 해당 비디오의 **암호화된 마스터 키(`encryptedMasterKey`)**와 **`솔트`**를 꺼냅니다.
        2. KEK를 이용해 `encryptedMasterKey`를 복호화하여 원본 마스터 키를 메모리에만 로드합니다.
        3. 가져온 마스터 키, 솔트, 그리고 표준화된 `info` 값을 **HKDF-SHA256 알고리즘**에 입력하여 **오직 이 세션에서만 유효한 일회성 `세션 키(Derived Key)`**를 생성합니다.
            *   **표준 `info` 구조:** `Buffer.concat([Buffer.from("LSV_ONLINE_V1"), ...])`
        4. 생성된 세션 키와 만료 정보를 클라이언트에 전달합니다.

4.  **청크 단위 복호화 및 재생 (클라이언트, `crypto.worker.ts`)**
    *   **기술:** **Web Worker**, **Web Crypto API (`crypto.subtle.decrypt`)**, Media Source Extensions (MSE)
    *   **재생 방식 (Prefetch-after-download):**
        1. **안정성 최우선:** 현재 구현은 Web Worker가 암호화된 `.lsv` 파일 전체를 먼저 다운로드합니다. 이 방식은 구현이 단순하고 디버깅이 용이하며, 네트워크 환경이 불안정할 때 가장 안정적인 재생을 보장합니다.
        2. **미래 확장성:** 향후 첫 N MB만 먼저 다운로드 및 복호화하여 재생을 시작하고, 나머지는 백그라운드에서 순차적으로 처리하는 **'프리패치 스트리밍'** 방식으로 개선하여 초기 로딩 속도를 더욱 단축할 수 있습니다.
    *   **복호화 과정:**
        1. 메인 스레드는 발급받은 서명된 URL과 세션 키를 **Web Worker(백그라운드 스레드)로 전달**합니다.
        2. Web Worker는 `.lsv` 파일 버퍼를 순차적으로 처리합니다.
        3. **[v5.0 핵심]** 각 청크마다 **4바이트 `길이 헤더`를 먼저 읽어** 해당 청크의 정확한 크기를 파악합니다.
        4. 해당 길이만큼의 데이터에서 **`IV`를 추출**하고, 청크 인덱스를 AAD로 설정한 뒤 나머지 부분(**암호화된 데이터 + 인증 태그**)을 복호화합니다.
        5. 모든 청크의 복호화가 성공하면, **하나로 합쳐진 완전한 비디오 파일(MP4)**을 메인 스레드로 전송합니다.
        6. 메인 스레드는 복호화된 전체 비디오 파일을 `MediaSource` 버퍼에 주입하고, HTML5 `<video>` 요소는 이를 재생합니다. 이 방식은 완전한 스트리밍은 아니지만, 청크 단위 검증을 통해 데이터 손상 시 **빠른 실패(fail-fast)**를 유도하여 무한 로딩을 방지하고 재생 안정성을 극대화합니다.

---

## Part 3. 보안 오프라인 다운로드 및 재생 (사용자)

1.  **용량 확인 및 라이선스 요청 (`lib/offline-db.ts` → `/api/offline-license`)**
    사용자가 다운로드 버튼을 클릭하면, 클라이언트는 먼저 `navigator.storage.estimate()`를 사용해 기기의 잔여 저장 공간을 확인합니다. 공간이 충분하면, 서버에 `videoId`와 `deviceId`를 전송하여 오프라인 라이선스를 요청합니다.

2.  **오프라인 키 생성 (서버, `/api/offline-license/route.ts`)**
    서버는 구독 권한을 확인하고, 마스터 키를 가져옵니다. 이번에는 **만료 시간(예: 7일 후)을 포함**하고 **`LSV_OFFLINE_V1`** 접두사를 사용한 표준 `info` 값으로 **HKDF 알고리즘**을 실행하여 **오프라인용 세션 키**를 생성합니다.

3.  **라이선스 발급 및 저장 (`lib/offline-db.ts`)**
    서버는 `오프라인용 세션 키`, `만료 시간`, `워터마크 시드`를 포함한 **오프라인 라이선스**를 클라이언트에 전달합니다. 클라이언트는 암호화된 `.lsv` 파일 전체와 이 라이선스를 함께 브라우저의 `IndexedDB`에 안전하게 저장합니다.

4.  **오프라인 재생 (`downloads/page.tsx` & `video-player-dialog.tsx`)**
    사용자가 오프라인 상태에서 다운로드한 영상을 재생하면, 앱은 `IndexedDB`에서 암호화된 비디오와 라이선스를 불러옵니다. 라이선스의 `만료 시간`을 확인한 후, **Web Worker**가 저장된 `오프라인용 세션 키`를 사용하여 **청크 단위로 실시간 복호화**하며 재생합니다.

---

## Part 4. 워터마크 및 보안 고지

*   **워터마크 처리 방식:**
    *   **목적:** 이 워터마크는 유출을 방지하는 기술이 아니라, **유출 발생 시 최초 유포자를 추적**하기 위한 **억제(Deterrent)** 수단입니다.
    *   **시드 생성:** 온라인/오프라인 키를 발급할 때, 서버는 `사용자 ID`를 해싱하여 고유한 **`워터마크 시드`** 문자열을 생성하여 키와 함께 전달합니다.
    *   **동적 렌더링 (`video-player-dialog.tsx`):** 비디오 플레이어는 전달받은 `워터마크 시드`를 비디오 위에 여러 개 복제하여 희미하게, 그리고 불규칙하게 움직이는 오버레이로 표시합니다.
    *   **한계:** 화면 녹화 후 크롭, 필터링 등으로 제거될 수 있습니다.

*   **보안 수준 고지:**
    *   본 시스템은 상용 DRM(Widevine, FairPlay) 솔루션이 아니며, Web Crypto API를 기반으로 합니다. 따라서 메모리 덤프, 코드 변조 등의 전문적인 공격으로부터 완벽하게 안전하지는 않습니다. 본 아키텍처는 추가 비용 없이 구현할 수 있는 **최대한의 보안 수준을 적용하여, 일반적인 사용자 및 비전문가에 의한 콘텐츠 불법 복제를 효과적으로 억제**하는 것을 목표로 합니다.

---

## Part 5. 장애 시나리오 및 UX 전략

**원칙:** ① 무한 로딩 금지 ② 항상 사용자에게 상황 고지 ③ 복구 가능한 오류는 자동, 불가능한 오류는 명확한 선택지 제공.

| 장애 유형 | 시나리오 | 감지 위치 | 사용자 UX | 자동 대응 |
| :--- | :--- | :--- | :--- | :--- |
| **네트워크** | Signed URL 만료 | Worker fetch (403) | "연결 갱신 중…" | 새 URL 자동 요청 |
| | 네트워크 끊김 | Worker fetch (Error) | "네트워크가 불안정합니다" | 3회 지수 백오프 재시도 |
| **암호화 처리** | **Length Header 손상** | Worker | 파일 손상 | "파일이 손상되었습니다" | 즉시 중단 (Fail-fast) |
| | **Auth Tag 불일치** | Worker decrypt | 무결성 실패 | "재생 불가(보안 오류)" | 재인증 및 재요청 |
| **키/세션** | 세션 키 만료 | Worker | TTL 초과 | "보안 세션 갱신 중" | 새 키 자동 요청 |
| | KEK 로드 실패 | Cloud Function | (사용자에게 도달 안 함) | 함수 실행 중단 | SRE/관리자 알림 |
| **플레이어** | MSE/코덱 미지원 | Main Thread | "브라우저 미지원" | Fallback 안내 | - |
| | Worker 비정상 종료 | Main Thread | Crash | "재생 복구 중" | Worker 재생성 |
| **오프라인** | 저장 공간 부족 | `saveVideo` | "공간 부족" | 다운로드 중단 | - |
| | 라이선스 만료 | `getDownloadedVideo` | "다운로드 만료" | 재인증/재다운로드 안내 | - |

**플레이어 상태 머신 (UX 구현 권장):**
```typescript
type PlayerState =
  | 'idle'
  | 'requesting-key'
  | 'downloading'
  | 'decrypting'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'recovering' // 자동 복구 시도 중
  | 'error-fatal' // 복구 불가능
  | 'error-retryable'; // 사용자 재시도 가능
```

---

## Part 6. 워크플로우 요약 (JSON)

```json
{
  "workflow": "LlineStream Video Processing & Playback",
  "version": "5.0-Robust-Chunked",
  "parts": [
    {
      "name": "Part 1: Video Upload & Backend Processing",
      "actor": "Admin",
      "steps": [
        {
          "step": 4,
          "description": "AI analysis and file encryption run in parallel. AI failure does not block encryption.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "aiAnalysis": {
              "model": "gemini-1.5-flash-preview",
              "statusField": "aiProcessingStatus",
              "retryable": "Yes, via admin panel."
            },
            "fileEncryption": {
              "library": "Node.js Crypto",
              "algorithm": "AES-256-GCM-CHUNKED-V3",
              "chunkSize": "1MB",
              "lsvChunkFormat": {
                "description": "The .lsv file is a concatenation of self-describing encrypted chunks for robust streaming.",
                "layout": "[ChunkLength(4B)][IV(12B)][Ciphertext(1MB)][AuthTag(16B)]...repeat",
                "integrity": "Each chunk's index is used as Additional Authenticated Data (AAD) to prevent reordering attacks."
              },
              "keyManagement": {
                "description": "A unique Master Key is generated per video, encrypted with a KEK (loaded from env/Secret Manager), and stored in the 'video_keys' collection."
              }
            }
          }
        }
      ]
    },
    {
      "name": "Part 2: Encrypted Video Playback (Online/Offline)",
      "actor": "User",
      "steps": [
        {
          "step": 7,
          "description": "Server generates a session-specific derived key using standardized HKDF, including a purpose prefix.",
          "file": "src/app/api/play-session/route.ts",
          "technicalDetails": {
            "keyDerivation": "HKDF-SHA256(masterKey, salt, Buffer.concat([Buffer.from('LSV_ONLINE_V1' | 'LSV_OFFLINE_V1'), ...]))",
            "response": "Includes derived key and its expiration time."
          }
        },
        {
          "step": 9,
          "description": "A Web Worker downloads the encrypted file and decrypts it chunk by chunk, verifying integrity at each step.",
          "file": "src/workers/crypto.worker.ts",
          "technicalDetails": {
            "decryption": "Uses Web Crypto API (AES-GCM). It processes the stream by first reading a 4-byte length header, then decrypting the specified chunk. This prevents full-stream failure from partial data corruption and enables stable seeking."
          }
        }
      ]
    }
  ]
}
```
