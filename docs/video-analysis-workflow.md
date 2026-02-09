# [공식] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v5.2 - True Streaming)

**목표:** v5.1에서 확보한 안정성 및 예측 가능성을 기반으로, **즉시 재생(True Streaming Seek)**과 **부분 청크 복구**를 도입하여 사용자 경험을 극대화하고, 오프라인 라이선스 모델을 정식화하여 보안 수준을 한 단계 더 끌어올린다.

---

## 1. 버전 히스토리

-   **v5.2 (Current): True Streaming Seek, 부분 청크 복구, 오프라인 라이선스 정식화**
    -   `v5.2.6` (개념) 운영 자동화를 위한 상세 로그 포인트 추가
    -   `v5.2.5` (개념) 리스크 기반 동적 워터마크 도입
    -   `v5.2.4` Online/Offline 키 스코프 암호학적 분리 및 검증
    -   `v5.2.3` 손상 청크 부분 재시도 로직 도입
    -   `v5.2.2` Seek-Buffering 상태 머신 추가
    -   `v5.2.1` HTTP Range 요청 기반 Chunk-on-Demand 스트리밍 구현
-   **v5.1:** 안정성 강화 패치 (Seek 안정성 명문화, 복호화 실패 상태 전이 규칙, 키 스코프 충돌 방지, AI 재처리 공식화)
-   **v5.0:** 스트리밍 아키텍처 교체 (Robust Chunked AES-GCM v5.0 도입), KEK 로딩 로직 개선

---

## 2. v5.2 아키텍처 (True Streaming)

v5.1의 "Prefetch-after-download" 모델에서 **"Chunk-on-Demand"** 모델로 진화하여, 초기 로딩 시간 단축과 즉각적인 탐색(seek)을 구현합니다.

```
[Client App] --(Play/Seek)--> [VideoPlayer]
     |
     +--> (1. Calc Required Chunk Index)
     |
     v
[Web Worker] --(2. Req Key)--> [API: /play-session]
     | (3. Receive DerivedKey)
     |
     +--> (4. Req URL) --> [API: /video-url]
     | (5. Receive Signed URL)
     |
     +--> (6. HTTP Range Fetch for specific chunk) --> [Firebase Storage (.lsv)]
     | (7. Receive chunk bytes)
     |
     +--> (8. Decrypt Chunk) -- (IF FAIL) --> [Retry Chunk Fetch (max 2)]
     | (9. Decrypt Success)
     v
[MediaSource Buffer] <--(10. Append Decrypted Chunk)-- [Web Worker]
     |
     v
[<video> Tag Playback]
```

### 핵심 변경점:

-   **데이터 요청 단위 변경:** 더 이상 전체 `.lsv` 파일을 요청하지 않습니다. Web Worker는 재생/탐색에 필요한 특정 청크의 바이트 범위(byte-range)만 HTTP `Range` 헤더를 통해 요청합니다.
-   **PlayerState 확장:** 탐색 후 데이터를 버퍼링하는 `buffering-seek` 상태가 추가되어, 사용자에게 현재 상태를 명확히 알려줍니다.

---

## 3. 핵심 변경점 상세 (v5.2 Patches)

### 3.1. True Streaming Seek (Chunk-Level Range Streaming)

-   **배경:** v5.1은 안정성을 위해 전체 파일을 다운로드한 후 재생을 시작하여 초기 로딩 시간이 길었습니다.
-   **v5.2 구현:**
    1.  **서버:** `/api/video-url` API는 변경 없이 그대로 사용됩니다. Firebase Storage의 서명된 URL(Signed URL)은 기본적으로 HTTP `Range` 요청을 지원합니다.
    2.  **클라이언트 (Worker):**
        -   재생 시작 시, 0번 청크부터 순차적으로 요청을 시작합니다.
        -   사용자가 특정 시간(time)으로 탐색하면, Worker는 `requiredChunkIndex = Math.floor(time / avgChunkDuration)` 공식을 통해 필요한 청크 인덱스를 계산합니다.
        -   계산된 인덱스에 해당하는 청크의 **정확한 바이트 범위**를 `Range` 헤더에 담아 `fetch`를 요청합니다. (이를 위해선 파일의 전체 청크 인덱스/오프셋 맵이 필요하며, 초기 로드 시 `.lsv` 파일의 헤더만 읽어 이 맵을 구성하는 방식이 이상적입니다.)
    -   **PlayerState:** 탐색 시, 플레이어는 `playing` -> `buffering-seek` 상태로 전환되며, 필요한 청크가 버퍼에 채워지면 다시 `playing` 상태가 됩니다.

### 3.2. 부분 청크 복구 (Partial Chunk Recovery)

-   **배경:** v5.1에서는 단일 청크의 인증 태그(Auth Tag) 검증 실패 시, 전체 재생을 `error-fatal`로 처리했습니다. 이는 안정적이지만, 일시적인 네트워크 오류로 인한 손상에는 과도한 대응입니다.
-   **v5.2 구현:**
    1.  **Worker 동작:** 특정 청크 복호화(decrypt) 실패 시, Worker는 즉시 중단하지 않습니다. 대신 `RECOVERABLE_ERROR` 메시지와 함께 실패한 `chunkIndex`를 메인 스레드로 보냅니다.
    2.  **메인 스레드 동작:**
        -   플레이어는 `recovering` 상태로 전환하고, UI에 "손상된 데이터 복구 중..." 메시지를 표시합니다.
        -   동일한 `chunkIndex`에 대해 최대 2회까지 재요청을 Worker에 지시합니다.
        -   2회 재시도 후에도 실패하면, 그 때 `error-fatal` 상태로 전환하여 "파일을 다시 받아야 합니다"와 같은 명확한 행동을 유도합니다.

### 3.3. 오프라인 라이선스 및 키 스코프 정식 분리

-   **배경:** v5.1에서는 온라인/오프라인 키의 구분이 암묵적이었습니다.
-   **v5.2 구현:**
    1.  **키 파생(HKDF) 분리:**
        -   **온라인:** `info` 값에 `LSV_ONLINE_V1` 접두사를 사용합니다.
        -   **오프라인:** `info` 값에 `LSV_OFFLINE_V1`, `deviceId`, `expiresAt`을 모두 포함하여, 키 자체가 특정 기기와 만료 시간에 종속되도록 합니다.
    2.  **서버 응답 명시:** `/api/play-session`과 `/api/offline-license` API 응답에 `scope` 필드(`ONLINE_STREAM_ONLY` 또는 `OFFLINE_PLAYBACK`)를 명시적으로 포함합니다.
    3.  **Worker 검증:** Worker는 키를 사용하기 전, 현재 재생 컨텍스트(온라인/오프라인)와 전달받은 키의 `scope`가 일치하는지 반드시 검증합니다. 불일치 시, `FATAL_ERROR`를 발생시켜 키 오용을 원천 차단합니다.
    -   **PlayerState 추가:** 오프라인 재생 시 만료된 라이선스를 사용하려 하면 `license-expired` 상태로 전환됩니다.

---

## 4. 최종 Player State Machine (v5.2)

```typescript
type PlayerState =
  | 'idle'
  | 'requesting-key'   // 세션 키 요청 중
  | 'downloading'      // (v5.2) 초기 청크 또는 탐색 청크 다운로드 중
  | 'decrypting'       // 수신된 청크 복호화 중
  | 'buffering-seek'   // 탐색 후, 재생에 필요한 청크 버퍼링 중
  | 'ready'            // 재생 시작 가능
  | 'playing'
  | 'paused'
  | 'recovering'       // 일시적 오류(네트워크, 단일 청크 손상) 자동 복구 시도 중
  | 'error-fatal'      // 복구 불가능 (e.g., 무결성 오류, 연속 복구 실패)
  | 'error-retryable'  // 사용자 재시도 가능 (e.g., 전체 복구 실패 후)
  | 'license-expired'; // 오프라인 라이선스 만료
```

---

## 5. 장애 시나리오 및 UX 전략 (v5.2)

**원칙:** ① 무한 로딩 금지 ② 항상 사용자에게 상황 고지 ③ 복구 가능하면 자동, 불가능하면 명확한 선택지 제공.

| 장애 유형 | 시나리오 | 감지 위치 | 사용자 UX | PlayerState | 자동 대응 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **네트워크** | Signed URL 만료 | Worker fetch (403) | 🔄 “연결 갱신 중…” | `recovering` | 새 URL 자동 요청 |
| | 청크 다운로드 실패 | Worker fetch (Error) | 📡 “네트워크 불안정, 재시도 중” | `recovering` | 실패 청크 2회 재시도 |
| **암호화 처리** | Auth Tag 불일치 | Worker decrypt | 🔄 “손상 데이터 복구 중” | `recovering` | 실패 청크 2회 재시도 |
| | 복구 최종 실패 | Main Thread | ❌ “파일 일부가 손상되었습니다” | `error-fatal` | 재생 중단, 새로고침 유도 |
| | 키 스코프 불일치 | Worker (시작 시) | ❌ “권한 확인 실패 (키 오용)” | `error-fatal` | 즉시 중단 |
| **재생/탐색** | 탐색(Seek) | User Interaction | 🔄 “이동 중…” | `buffering-seek` | 해당 위치 청크 로드 |
| **오프라인** | 라이선스 만료 | Player (시작 시) | ⏰ “다운로드 기간 만료” | `license-expired` | 재다운로드 안내 |

---

## 6. 보안 및 기타

-   **보안 수준 고지:** 본 시스템은 상용 DRM(Widevine, FairPlay) 솔루션이 아니며, Web Crypto API를 기반으로 합니다. 메모리 덤프 등의 전문적인 공격으로부터 완벽하게 안전하지는 않으며, 일반적인 사용자에 의한 콘텐츠 불법 복제를 효과적으로 **억제(Deterrent)**하는 것을 목표로 합니다.
-   **워터마크:** v5.2에서는 사용자 계정의 신뢰도, 재생 환경(온라인/오프라인) 등에 따라 워터마크의 강도(표시 빈도, 투명도)를 서버가 동적으로 결정하여 세션 키와 함께 전달하는 **리스크 기반 동적 워터마크(Risk-Adaptive Watermark)** 개념을 도입합니다. (구체적인 리스크 모델은 추후 정의)

