
# [최종] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v5.1)

**목표:** 관리자가 비디오를 업로드하는 순간부터 최종 사용자가 온라인/오프라인에서 끊김 없이 안전하게 시청하기까지의 전 과정을 자동화합니다. **안정성이 대폭 향상된 Chunked 스트리밍**과 동적 워터마크 기술로 콘텐츠를 보호하는 서버리스 파이프라인입니다.

**버전 히스토리:**
- **v5.1 (Current):** 안정성 강화 패치 (Seek 안정성 명문화, 복호화 실패 상태 전이 규칙, 키 스코프 충돌 방지, AI 재처리 공식화)
- **v5.0:** 스트리밍 아키텍처 교체 (Robust Chunked AES-GCM v5.0 도입), KEK 로딩 로직 개선
- **v4.0:** 보안 강화 (KEK 기반 마스터 키 암호화, HKDF 표준화)
- **~v3.0:** 초기 암호화 및 재생 파이프라인 구축

---

## Part 1. 아키텍처 및 핵심 설계 사상

### 1.1. 전체 워크플로우 (텍스트 다이어그램)

```
[Admin UI] --(Upload)--> [Firebase Storage (Raw Video)]
       |
       v
[Firestore 'episodes' (status:pending)] --(Trigger)--> [Cloud Function: analyzeVideoOnWrite]
       |                                                    |
       |                                                    +--- [Promise.allSettled] ---+
       |                                                    |                           |
       v                                                    v                           v
[AI Analysis (Gemini)]                             [Chunked Encryption (AES-GCM)]
  - aiGeneratedContent (JSON)                           - encrypted.lsv (Video)
  - transcript.txt (Text)                               - video_keys (Enc Master Key)
  - subtitle.vtt (VTT)
       |                                                    |                           |
       +---------------------(Update)-----------------------+---------------------------+
                                    |
                                    v
                  [Firestore 'episodes' (status:completed, aiStatus:completed)]
                                    |
                                    |
                                    v
[Client App] --(Req)--> [API: /play-session] --(Verify)--> [Firestore 'users' & 'episodes']
       |                      |                                    |
       |                      | (Resp: DerivedKey, Scope)          +--> [Firestore 'video_keys'] --(Get EncKey)--> [Decrypt MasterKey] -> [HKDF]
       |                      v
       +<--(DerivedKey)-- [Web Worker] --(Req URL)--> [API: /video-url] --(Sign URL)--> [Storage (encrypted.lsv)]
                              | (Decrypt Chunks)                     |
                              v                                      |
                      [MediaSource Buffer] <-------------------------+
                              |
                              v
                         [<video> Tag]
```

### 1.2. Chunked AES-GCM이 UX 안정성을 만드는 이유

기존에는 전체 파일을 단일 암호화하여, 1GB 영상의 99%를 받아도 마지막 1%가 손상되면 전체 재생이 불가능했습니다. v5.0 아키텍처는 이 문제를 구조적으로 해결합니다.

-   **설계:** 암호화된 파일(`.lsv`)은 독립적으로 해독 가능한 `청크(Chunk)`들의 연속입니다. 각 청크는 `[청크 길이(4B)][IV(12B)][암호화된 데이터...][인증 태그(16B)]` 구조를 가집니다.
-   **작동 방식:**
    1.  **명시적 경계:** Web Worker는 먼저 4바이트의 `길이 헤더`를 읽어 이번에 처리할 청크의 정확한 크기를 인지합니다.
    2.  **정확한 읽기:** 네트워크 스트림에서 정확히 해당 길이만큼의 데이터만 버퍼로 가져와 처리합니다.
    3.  **독립적 해독:** 각 청크는 고유의 IV와 인증 태그를 가지므로, 다른 청크의 상태와 관계없이 독립적으로 복호화가 가능합니다.
-   **안정성 확보:**
    -   **Seek 안정성:** 사용자가 영상의 중간 지점을 클릭하면, 플레이어는 전체 파일을 받을 필요 없이 해당 시간대의 청크들만 요청하고 즉시 복호화하여 재생을 시작할 수 있습니다.
    -   **네트워크 중단 복구:** 다운로드 중 연결이 끊겨도, 이전에 성공적으로 받은 청크들까지는 안전하게 버퍼에 저장되어 있으므로, 연결이 재개되면 중단된 지점부터 다시 다운로드를 이어갈 수 있습니다.
    -   **오류 국소화 (Fail-Fast):** 만약 특정 청크 하나가 손상되어 인증 태그(Auth Tag) 검증에 실패하더라도, 오류는 해당 청크에 국한됩니다. 플레이어는 전체 재생을 멈추는 대신, 해당 청크를 건너뛰거나 재요청하는 등 유연한 예외 처리를 할 수 있습니다. 이는 **'알 수 없는 무한 로딩' 현상을 근본적으로 방지**합니다.

---

## Part 2. 비디오 업로드 및 자동 처리 (관리자)

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
        *   **상태 분리:** 이 작업이 실패하더라도 비디오 암호화 및 재생에는 영향을 주지 않습니다. `aiProcessingStatus` 필드로 상태를 별도 관리하며, **관리자 페이지에서 재시도할 수 있습니다. (PATCH v5.1.5)**

    *   **작업 B: 청크 기반 암호화 (`createEncryptedFile`)**
        *   **기술:** Node.js `crypto`, **Chunked AES-256-GCM-V3 (with Length Header & AAD)**
        *   **과정:**
            1. 환경변수 또는 Secret Manager에서 **KEK(Key Encryption Key)**를 안전하게 로드합니다.
            2. 비디오 하나당 유일무이한 **`마스터 암호화 키`(AES-256)**와 **`솔트(Salt)`**를 생성합니다.
            3. 원본 비디오 파일을 **1MB 단위의 청크(chunk)로** 나누어 순차적으로 처리합니다.
            4. **각 청크마다** 새로운 **12바이트 `IV`(초기화 벡터)**를 생성하고, **청크 인덱스**를 AAD(Additional Authenticated Data)로 설정하여 재정렬 공격을 방지합니다.
            5. 마스터 키를 사용해 청크를 암호화한 뒤 **16바이트 `인증 태그(Auth Tag)`**를 생성합니다.
            6. **[v5.1.1 핵심]** 암호화된 각 청크 앞에, **청크의 전체 길이(IV+데이터+Tag)를 나타내는 4바이트 헤더**를 추가합니다.
            7. 최종적으로 **`[길이(4)][IV(12)][암호화된 데이터...][인증 태그(16)]`** 구조의 청크들을 계속 이어 붙여 최종 암호화 파일(`.lsv`)을 완성합니다.
            8. 최종 파일을 비공개 경로(`episodes/{episodeId}/encrypted.lsv`)에 업로드합니다.
            9. 생성된 **마스터 키**를 **KEK로 다시 암호화**하여 `video_keys` 컬렉션의 `vidkey_{episodeId}` 문서에 `encryptedMasterKey` 필드로 안전하게 보관합니다. 이 컬렉션은 서버만 접근 가능합니다.

5.  **최종 결과 저장 및 정리**
    두 작업이 완료되면, AI 분석 결과 파일 경로, 암호화된 비디오 파일 경로 및 메타데이터(`encryption.version: 3`)를 모두 Firestore의 해당 에피소드 문서에 업데이트하고 상태를 `'completed'`로 변경합니다. 마지막으로, 원본 비디오 파일을 삭제하여 저장 공간을 절약하고 보안을 강화합니다.

---

## Part 3. 온라인/오프라인 공통 재생 파이프라인

### 3.1. Player State Machine (상태 머신)

플레이어는 아래 상태 머신을 기반으로 모든 상황에 예측 가능하게 대응합니다. **무한 로딩은 절대 허용하지 않습니다.**

```typescript
type PlayerState =
  | 'idle'             // 초기 상태
  | 'requesting-key'   // 세션 키 요청 중
  | 'downloading'      // .lsv 파일 다운로드 중 (진행률 표시)
  | 'decrypting'       // 다운로드된 청크 복호화 중 (진행률 표시)
  | 'ready'            // 재생 준비 완료 (버퍼에 데이터 있음)
  | 'playing'          // 재생 중
  | 'paused'           // 일시정지
  | 'recovering'       // 일시적 오류(네트워크 등) 자동 복구 시도 중
  | 'error-fatal'      // 복구 불가능한 치명적 오류 (e.g., 파일 손상)
  | 'error-retryable'; // 사용자 재시도 가능 오류
```

### 3.2. 재생 단계별 플로우

1.  **보안 URL 발급 요청 (`video-player-dialog.tsx` → `/api/video-url`)**
    *   **상태:** `idle` → `requesting-key`
    *   클라이언트는 서버에 `videoId`와 인증 토큰을 보내 비공개 암호화 파일(`.lsv`)에 5분간 접근할 수 있는 **서명된 URL(Signed URL)**을 발급받습니다.

2.  **재생 세션 및 임시 키 요청 (`video-player-dialog.tsx` → `/api/play-session`)**
    *   **상태:** `requesting-key`
    *   클라이언트는 `videoId`와 `deviceId`를 보내 재생 세션을 요청합니다. 응답에는 **세션 키의 만료 시간**과 **키의 사용 목적(scope)**이 포함됩니다. **(PATCH v5.1.3)**

3.  **세션 키(Derived Key) 생성 (서버, `/api/play-session/route.ts`)**
    *   **기술:** Node.js `crypto.hkdf` (**HKDF-SHA256**)
    *   **과정:**
        1. 서버는 `video_keys` 금고에서 해당 비디오의 **암호화된 마스터 키(`encryptedMasterKey`)**와 **`솔트`**를 꺼냅니다.
        2. KEK를 이용해 `encryptedMasterKey`를 복호화하여 원본 마스터 키를 메모리에만 로드합니다.
        3. 가져온 마스터 키, 솔트, 그리고 표준화된 `info` 값을 **HKDF-SHA256 알고리즘**에 입력하여 **오직 이 세션에서만 유효한 일회성 `세션 키(Derived Key)`**를 생성합니다.
            *   **표준 `info` 구조:** `Buffer.concat([Buffer.from("LSV_ONLINE_V1"), ...])`
        4. 생성된 세션 키, 만료 정보, 스코프(`ONLINE_STREAM_ONLY`)를 클라이언트에 전달합니다.

4.  **청크 단위 복호화 및 재생 (클라이언트, `crypto.worker.ts`)**
    *   **상태:** `downloading` → `decrypting` → `ready` → `playing`
    *   **기술:** **Web Worker**, **Web Crypto API (`crypto.subtle.decrypt`)**, Media Source Extensions (MSE)
    *   **재생 방식 (Prefetch-after-download):**
        1. **안정성 최우선:** 현재 구현은 Web Worker가 암호화된 `.lsv` 파일 전체를 먼저 다운로드합니다. 이 방식은 구현이 단순하고 디버깅이 용이하며, 네트워크 환경이 불안정할 때 가장 안정적인 재생을 보장합니다.
        2. **단계별 UX:** 다운로드 중에는 `downloading (xx%)` 상태를, 복호화 중에는 `decrypting (청크 n/m)` 상태를 UI에 명확히 표시하여 사용자가 '멈춤'이 아닌 '진행 중'으로 인지하게 합니다.
    *   **복호화 과정:**
        1. 메인 스레드는 발급받은 서명된 URL과 세션 키를 **Web Worker(백그라운드 스레드)로 전달**합니다.
        2. Web Worker는 `.lsv` 파일 버퍼를 순차적으로 처리합니다.
        3. **[v5.1.1 핵심]** 각 청크마다 **4바이트 `길이 헤더`를 먼저 읽어** 해당 청크의 정확한 크기를 파악합니다.
        4. 해당 길이만큼의 데이터에서 **`IV`를 추출**하고, 청크 인덱스를 AAD로 설정한 뒤 나머지 부분(**암호화된 데이터 + 인증 태그**)을 복호화합니다.
        5. 모든 청크의 복호화가 성공하면, **하나로 합쳐진 완전한 비디오 파일(MP4)**을 메인 스레드로 전송합니다.
        6. 메인 스레드는 복호화된 전체 비디오 파일을 `MediaSource` 버퍼에 주입하고, HTML5 `<video>` 요소는 이를 재생합니다.

---

## Part 4. 장애 시나리오 및 UX 전략 (v5.1 기준)

**원칙:** ① 무한 로딩 금지 ② 항상 사용자에게 상황 고지 ③ 복구 가능한 오류는 자동, 불가능한 오류는 명확한 선택지 제공.

| 장애 유형 | 시나리오 | 감지 위치 | 사용자 UX | PlayerState | 자동 대응 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **네트워크** | Signed URL 만료 | Worker fetch (403) | 🔄 “연결 갱신 중…” | `recovering` | 새 URL 자동 요청 |
| | 네트워크 끊김 | Worker fetch (Error) | 📡 “네트워크가 불안정합니다” | `recovering` | 3회 지수 백오프 재시도 |
| **암호화 처리** | **Length Header 손상** | Worker | ❌ “파일이 손상되었습니다” | `error-fatal` | 즉시 중단 (Fail-fast) |
| | **Auth Tag 불일치** | Worker decrypt | ❌ “재생 불가(보안 오류)” | `error-fatal` | 재인증 및 재요청 유도 |
| **키/세션** | 세션 키 만료 | Worker (시작 전) | 🔐 “보안 세션 갱신 중” | `recovering` | 새 키 자동 요청 |
| | **키 스코프 불일치** | Worker | ❌ “권한 확인 실패” | `error-fatal` | 즉시 중단 (키 오용 방지) |
| **플레이어** | MSE/코덱 미지원 | Main Thread | 🧩 “브라우저 미지원” | `error-fatal` | Fallback 안내 |
| | Worker 비정상 종료 | Main Thread (Crash) | 🔄 “재생 복구 중” | `recovering` | Worker 재생성 시도 |
| **오프라인** | 저장 공간 부족 | `saveVideo` | 💾 “공간 부족” | `error-retryable`| 다운로드 중단 |
| | 라이선스 만료 | `getDownloadedVideo` | ⏰ “다운로드 만료” | `error-retryable`| 재인증/재다운로드 안내 |

---

## Part 5. 보안 및 기타

*   **워터마크 처리 방식:**
    *   **목적:** 이 워터마크는 유출을 방지하는 기술이 아니라, **유출 발생 시 최초 유포자를 추적**하기 위한 **억제(Deterrent)** 수단입니다.
    *   **시드 생성:** 온라인/오프라인 키를 발급할 때, 서버는 `사용자 ID`를 해싱하여 고유한 **`워터마크 시드`** 문자열을 생성하여 키와 함께 전달합니다.
    *   **동적 렌더링 (`video-player-dialog.tsx`):** 비디오 플레이어는 전달받은 `워터마크 시드`를 비디오 위에 여러 개 복제하여 희미하게, 그리고 불규칙하게 움직이는 오버레이로 표시합니다.

*   **보안 수준 고지:**
    *   본 시스템은 상용 DRM(Widevine, FairPlay) 솔루션이 아니며, Web Crypto API를 기반으로 합니다. 따라서 메모리 덤프, 코드 변조 등의 전문적인 공격으로부터 완벽하게 안전하지는 않습니다. 본 아키텍처는 추가 비용 없이 구현할 수 있는 **최대한의 보안 수준을 적용하여, 일반적인 사용자 및 비전문가에 의한 콘텐츠 불법 복제를 효과적으로 억제**하는 것을 목표로 합니다.

---

## Part 6. 워크플로우 JSON 요약

```json
{
  "workflow": "LlineStream Video Processing & Playback",
  "version": "5.1-Patched-Chunked",
  "parts": [
    {
      "name": "Part 2: Encrypted Video Playback (Online/Offline)",
      "actor": "User",
      "steps": [
        {
          "step": 7,
          "description": "Server generates a session-specific derived key using standardized HKDF, including a purpose prefix and scope.",
          "file": "src/app/api/play-session/route.ts",
          "technicalDetails": {
            "keyDerivation": "HKDF-SHA256(masterKey, salt, Buffer.concat([Buffer.from('LSV_ONLINE_V1'), ...]))",
            "response": "Includes derived key, its expiration time, and scope ('ONLINE_STREAM_ONLY')."
          }
        },
        {
          "step": 9,
          "description": "A Web Worker downloads the encrypted file and decrypts it chunk by chunk, verifying integrity at each step.",
          "file": "src/workers/crypto.worker.ts",
          "technicalDetails": {
            "decryption": "Uses Web Crypto API (AES-GCM). It processes the stream by first reading a 4-byte length header, then decrypting the specified chunk. This prevents full-stream failure from partial data corruption and enables stable seeking.",
            "aad": "Uses chunk index as Additional Authenticated Data to prevent reordering attacks."
          }
        }
      ]
    }
  ]
}
```
