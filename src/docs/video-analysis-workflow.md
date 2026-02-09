# [공식] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v5.3)

**목표:** v5.2에서 확보한 안정성·예측 가능성·운영 복구성을 기반으로, **즉시 재생(True Streaming Seek)**, **부분 복구**, 그리고 **오프라인 다운로드 및 라이선스** 기능을 완성하여 상용 DRM 도입 이전의 최종 아키텍처를 구축합니다.

---

## 1. 버전 히스토리

- **v5.3 (Current): Offline Playback & Dynamic Watermark**
  - `v5.3.0` (구현) 오프라인 다운로드 및 7일 라이선스 재생 기능 완성 (IndexedDB)
  - `v5.3.1` (구현) 온라인/오프라인 통합 동적 워터마킹 시스템 도입
  - `v5.3.2` (구현) 리스크 기반 워터마크 강도 조절 정책 추가 (`normal`/`aggressive`)
  - `v5.3.3` (구현) 오프라인 재생 시 시스템 시간 롤백 감지 로직 추가
- **v5.2.x:** True Streaming & UX 고도화
  - `v5.2.7` (구현) 상태 머신 타임아웃 및 경쟁 상태 방지 규칙 강제. 디버그 로깅 시스템 도입.
  - `v5.2.4` (구현) 온라인/오프라인 라이선스 키 스코프 정식 분리 및 검증
  - `v5.2.3` (구현) 단일 청크 손상 시 부분 복구(재시도) 로직 도입
  - `v5.2.1` (구현) HTTP Range 요청 기반 Chunk-on-Demand 스트리밍 도입
- **v5.1.x:** 안정성 강화 (Prefetch-after-download)
  - `v5.1.9` (구현) Worker 생명주기 및 복구 규칙 정의
  - `v5.1.8` (구현) 청크 복호화 실패 시 Fail-Fast 정책 강제
  - `v5.1.7` (구현) Signed URL 및 세션 키 Race Condition 방지 규칙 적용
- **v5.0:** 스트리밍 아키텍처 교체 (Robust Chunked AES-GCM)

---

## 2. 전체 워크플로우 (v5.3)

### 2.1. 파일 업로드 및 처리 (서버)
1.  **[Admin] 파일 업로드:** 관리자가 원본 비디오 파일(mp4)을 업로드합니다.
2.  **[Cloud Function] 처리 시작:** `onDocumentWritten` 트리거가 실행됩니다.
3.  **[Cloud Function] 병렬 처리:** `Promise.allSettled`를 사용하여 **AI 분석**과 **암호화**를 동시에 진행합니다.
    *   **AI 분석 (Gemini):** 비디오를 분석하여 요약, 타임라인, 자막(VTT), 전체 텍스트 스크립트를 생성합니다. (대용량 스크립트는 별도 .txt 파일로 저장)
    *   **암호화 (AES-256-GCM-CHUNKED-V3):**
        1.  원본 비디오를 1MB 단위 청크로 분할합니다.
        2.  각 청크를 암호화하고, **청크의 길이를 담은 4바이트 헤더**를 앞에 붙여 `[길이][암호화된 데이터]` 구조를 만듭니다. 이는 스트리밍 안정성의 핵심입니다.
        3.  모든 청크를 하나의 `.lsv` 파일로 합쳐 비공개 스토리지에 저장합니다.
        4.  파일 암호화에 사용된 **마스터 키**는 서버의 KEK(Key-Encryption-Key)로 다시 암호화하여 `video_keys` 컬렉션에 안전하게 보관합니다.
4.  **[Cloud Function] 원본 삭제:** 모든 처리가 끝나면 원본 비디오 파일을 스토리지에서 삭제합니다.

### 2.2. 온라인 스트리밍 재생 (클라이언트)
1.  **[Client] 재생 요청:** 사용자가 재생 버튼을 클릭합니다.
2.  **[Client] 키 요청:** `/api/play-session`을 호출하여 온라인 재생 전용 **임시 세션 키**와 **워터마크 시드**를 발급받습니다.
3.  **[Client] URL 요청:** `/api/video-url`을 호출하여 암호화된 `.lsv` 파일에 접근할 수 있는 단기 유효 `Signed URL`을 받습니다.
4.  **[Worker] 초기화:** 세션 키와 Signed URL을 Web Worker로 전달하여 초기화합니다.
5.  **[Worker] Offset Map 생성:** Worker는 Signed URL을 통해 `.lsv` 파일의 앞부분 수 KB만 **HTTP Range 요청**으로 가져옵니다. 이 데이터로 각 청크의 `[길이]` 헤더를 읽어, 전체 청크의 시작/끝 바이트 위치를 담은 `Offset Map`을 메모리에 구축합니다.
6.  **[Worker] 실시간 복호화 및 전송:**
    *   재생에 필요한 청크 인덱스부터 `Offset Map`을 참조하여 `Range` 요청으로 청크 데이터를 가져옵니다.
    *   가져온 청크를 복호화하여 `decryptedChunk`를 메인 스레드로 전송합니다.
7.  **[Main Thread] 재생:** 메인 스레드는 복호화된 청크를 `MediaSource` API를 통해 `<video>` 태그에 주입하여 재생합니다.
8.  **[Main Thread] 워터마크 렌더링:** 서버에서 받은 워터마크 시드를 기반으로 사용자 식별자가 포함된 워터마크를 비디오 위에 오버레이로 렌더링합니다.

### 2.3. 오프라인 다운로드 및 재생
1.  **[Client] 다운로드 요청:** 사용자가 다운로드 버튼을 클릭합니다.
2.  **[Client] 저장 공간 확인:** `navigator.storage.estimate()`를 통해 저장 공간이 충분한지 확인합니다. 부족하면 즉시 오류를 표시합니다.
3.  **[Client] 오프라인 라이선스 요청:** `/api/offline-license`를 호출합니다.
4.  **[Server] 라이선스 발급:**
    *   서버는 **7일 유효기간**을 설정하고, 사용자와 기기 정보가 포함된 `info` 값으로 **오프라인 전용 키**를 파생(HKDF)합니다.
    *   `videoId`, `userId`, `deviceId`, `expiresAt`, `scope: "OFFLINE_PLAYBACK"`, `watermarkSeed` 등이 포함된 라이선스를 생성하여 반환합니다.
5.  **[Client] 파일 다운로드 및 저장:**
    *   `Signed URL`을 통해 전체 `.lsv` 파일을 다운로드합니다.
    *   다운로드한 암호화된 비디오 데이터와 발급받은 라이선스를 **하나의 객체로 묶어 IndexedDB에 저장**합니다.
6.  **[Client] 오프라인 재생:**
    *   IndexedDB에서 비디오 데이터와 라이선스를 로드합니다.
    *   **라이선스 유효성 검증:** `expiresAt`과 `deviceId`를 확인합니다. 만료되었거나 다른 기기일 경우 재생을 차단하고 `license-expired` 상태로 전환합니다.
    *   검증 통과 시, 암호화된 비디오 데이터와 오프라인 키를 Worker로 전달하여 온라인 재생과 동일한 방식으로 복호화 및 재생을 수행합니다. 워터마크도 동일하게 렌더링됩니다.

---

## 3. Player State Machine (v5.3)

플레이어의 모든 동작은 아래의 15개 상태로 명확하게 정의되며, 무한 로딩을 방지하기 위한 타임아웃 규칙이 강제됩니다.

```typescript
type PlayerState =
  | 'idle'
  | 'requesting-key'      // Timeout: 3s
  | 'downloading'         // (Offset Map 구성 또는 청크 다운로드)
  | 'decrypting'          // (Web Worker 내부 작업)
  | 'buffering-seek'      // Timeout: 5s
  | 'ready'               // 재생 가능 (버퍼에 데이터 충분)
  | 'playing'
  | 'paused'
  | 'recovering'          // Timeout: 15s (네트워크 오류, 청크 재시도)
  | 'error-fatal'         // 복구 불가 (파일 손상, 키 스코프 오류 등)
  | 'error-retryable'
  | 'license-expired'     // 오프라인 라이선스 만료
  | 'offline-downloading' // 오프라인 저장 중
  | 'offline-ready'
  | 'offline-playing';
```

### 3.1. 경쟁 상태 방지 (Race Condition) - 절대 규칙
모든 Worker와 Main Thread 간의 비동기 통신은 `requestId`에 바인딩됩니다. Main Thread가 새로운 요청(예: 다른 비디오 재생, 탐색)을 시작하면 새로운 `requestId`를 생성합니다. **Worker는 이전에 받은 `requestId`와 일치하지 않는 모든 요청 결과를 폐기하여, 상태 오염을 원천적으로 방지합니다.**

---

## 4. 장애 시나리오 및 UX 전략 (v5.3 기준)

**원칙:** ① 무한 로딩 절대 금지 ② 항상 명확한 상태 피드백 ③ 자동 복구 우선, 실패 시 명확한 행동 유도

| 장애 유형 | 시나리오 | 감지 위치 | 사용자 UX | PlayerState | 자동 대응 (v5.3) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **스트리밍** | **탐색(Seek)** | **Video Element** | ⏳ “이동 중…” | **`buffering-seek`** | **필요한 청크만 Range 요청** |
| | **단일 청크 손상** | **Worker (decrypt)** | 🔄 “데이터 복구 중…” | **`recovering`** | **해당 청크 최대 2회 재요청** |
| | 청크 복구 최종 실패 | Main Thread | ❌ “파일 일부가 손상됨” | `error-fatal` | 재생 중단, 재시도 안내 |
| **네트워크** | Signed URL 만료 | Worker (fetch) | 🔄 “연결 갱신 중…” | `recovering` | 새 URL 자동 요청 |
| | 네트워크 끊김 | Worker (fetch) | 📡 “네트워크 연결 불안정” | `recovering` | 3회 지수 백오프 재시도 |
| **암호화/키** | Auth Tag 불일치 | Worker (decrypt) | 🔄 “데이터 복구 중…” | `recovering` | 손상된 청크로 간주, 재시도 |
| | **키 스코프 불일치** | **Worker (시작 시)** | ❌ “권한 확인 실패” | **`error-fatal`** | **즉시 중단 (키 오용)** |
| | 세션 키 만료 | Worker (시작 시) | 🔐 “보안 세션 갱신 중” | `recovering` | 새 키 자동 요청 |
| **오프라인** | **라이선스 만료** | **Player (시작 시)** | ⏰ “다운로드 기간 만료” | **`license-expired`** | **재생 차단, 재다운로드 안내** |
| | 저장 공간 부족 | `saveVideo` | 💾 “저장 공간 부족” | `error-retryable` | 다운로드 중단 |
| | IndexedDB 손상 | `getDownloadedVideo` | ❌ "저장된 파일 오류" | `error-fatal` | 재다운로드 안내 |

---

## 5. 보안 및 기타

-   **워터마크 처리:** 워터마크는 서버에서 생성된 `watermarkSeed`를 기반으로 클라이언트에서 렌더링됩니다. 이는 비디오 데이터 자체에 포함되지 않는 오버레이 방식이며, 유출 시 사용자를 특정하기 위한 **억제 및 추적** 수단입니다. `aggressive` 모드를 통해 고위험 계정으로 판단될 경우 더 빈번하고 잘 보이는 워터마크를 동적으로 렌더링할 수 있습니다.
-   **보안 수준 고지:** 본 시스템은 Widevine, FairPlay와 같은 상용 DRM 솔루션이 아니며, Web Crypto API를 기반으로 합니다. 메모리 덤프, 고급 스크린 캡처 등의 전문적인 공격으로부터 완벽하게 안전하지는 않으며, 일반적인 사용자에 의한 콘텐츠 불법 복제를 효과적으로 **억제(Deterrent)**하고, 유출 시 **책임 소재를 추적**하는 것을 목표로 합니다.
-   **관측 가능성 (Observability):** 모든 플레이어 상태 전이, 오류, 재시도 횟수, 주요 동작(seek, init)의 소요 시간은 `isOffline`, `playbackContext` 등의 메타데이터와 함께 디버그 로깅 시스템에 기록되어, 문제 발생 시 신속한 원인 분석을 지원합니다.
