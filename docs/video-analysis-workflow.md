# [공식] 비디오 처리, 보안 재생 및 오프라인 워크플로우 (v5.3 FINAL)

**목표:** v5.2의 안정적인 스트리밍 기반 위에, **완전한 오프라인 재생 경험**과 **강화된 유출 추적 기능(워터마크)**을 통합하여, 비-DRM 환경에서 구현 가능한 최고 수준의 사용자 경험과 보안 모델을 완성한다.

---

## 1. 버전 히스토리

- **v5.3 (FINAL): True Offline & Dynamic Watermark**
  - `v5.3.0` (구현) 오프라인 다운로드 및 7일 만료 라이선스 재생 로직 전체 구현.
  - `v5.3.0` (구현) 온라인/오프라인 재생 시 동적 워터마크 렌더링 및 위험 적응형 강도 조절 기능 추가.
- **v5.2.x:** True Streaming & Stability Patches
  - `v5.2.7` (구현) 상태 머신 타임아웃 및 경쟁 상태 방지 규칙 강제. 디버그 로깅 시스템 도입.
  - `v5.2.4` (구현) 오프라인 라이선스 키 스코프 정식 분리 및 검증.
  - `v5.2.3` (구현) 단일 청크 손상 시 부분 복구(재시도) 로직 도입.
  - `v5.2.1` (구현) HTTP Range 요청 기반 Chunk-on-Demand 스트리밍 도입.
- **v5.1.x:** 안정성 강화 (Fail-Fast, Worker 생명주기 정의 등)
- **v5.0:** 스트리밍 아키텍처 교체 (Robust Chunked AES-GCM)

---

## 2. v5.3 아키텍처 핵심: 온라인과 오프라인의 통합 파이프라인

v5.3은 온라인 스트리밍과 오프라인 재생이 동일한 암호화 파일(`.lsv`)과 복호화 로직(Web Worker)을 공유하지만, **키 발급 단계에서 암호학적으로 완벽히 분리**되는 하이브리드 모델을 채택한다.

```
[Client App]
     |
     +-- (Online) --→ /api/play-session --→ [ONLINE Key (단기 유효)]
     |                                          |
     +-- (Offline) -→ /api/offline-license → [OFFLINE Key (7일 유효, 기기 바인딩)]
     |                                          |
     ↓                                          ↓
[Video Player] --(Key, .lsv URL/Buffer)--> [Web Worker]
     |                                          | (동일한 복호화 로직)
     |                                          ↓
     +------------------------------------ [Decrypted MP4 Chunks]
     |                                          |
     ↓                                          ↓
[MediaSource] ←--------------------------- [Append Buffer]
     |
     ↓
[<video> Element]
     +
[Watermark Overlay (seed 기반)]
```

### 2.1. 온라인 스트리밍 (v5.2 계승)
-   `Chunk Offset Map`을 사용한 **True Streaming Seek**를 그대로 유지하여 빠른 로딩과 탐색을 보장한다.
-   단일 청크 손상 시 **부분 복구(재시도)** 로직이 동일하게 동작한다.
-   `play-session` API를 통해 발급된 **단기 유효 세션 키**만을 사용한다.

### 2.2. 오프라인 다운로드 및 재생 (v5.3 신규)

**[다운로드 단계]**
1.  **권한 확인 및 공간 확보:** 사용자가 다운로드 버튼을 누르면, 서버는 해당 영상에 대한 사용자의 구독/구매 상태를 확인한다. 동시에 클라이언트는 `navigator.storage.estimate()`를 통해 충분한 저장 공간이 있는지 확인한다.
2.  **오프라인 라이선스 발급:** 클라이언트는 `/api/offline-license`를 호출한다. 서버는 **7일 만료 시간**과 **디바이스 ID**를 포함한 HKDF `info` 값을 사용하여 **오프라인 전용 키**를 파생하고, `watermarkSeed`와 함께 라이선스 객체를 생성하여 반환한다.
3.  **암호화 파일 다운로드:** 클라이언트는 `/api/video-url`을 통해 받은 Signed URL로 **전체 `.lsv` 파일**을 다운로드한다.
4.  **IndexedDB 저장:** 다운로드된 `.lsv` 파일(ArrayBuffer)과 발급받은 오프라인 라이선스 객체를 **하나의 레코드로 묶어 IndexedDB에 저장**한다. 평문 비디오 데이터는 디스크에 절대 저장되지 않는다.

**[오프라인 재생 단계]**
1.  **라이선스 검증:** 플레이어는 IndexedDB에서 라이선스를 로드하여 다음을 검증한다.
    -   `scope`가 `OFFLINE_PLAYBACK`인지 확인.
    -   `expiresAt`이 현재 시간 이후인지 확인 (만료 여부).
    -   (선택) `lastCheckedAt`과 현재 시간을 비교하여 시스템 시간 조작 여부 탐지.
2.  **Worker로 데이터 전송:** 검증을 통과하면, IndexedDB에서 읽어온 `.lsv` 파일 `ArrayBuffer`와 오프라인 키를 Web Worker로 직접 전송한다. (네트워크 요청 없음)
3.  **복호화 및 재생:** Worker는 온라인 스트리밍과 **동일한 로직**으로 `ArrayBuffer`를 복호화하여 MediaSource에 주입한다. 단, 네트워크 오류가 없으므로 청크 재시도 로직은 동작하지 않으며, 복호화 실패는 즉시 `error-fatal`로 이어진다.

---

## 3. 동적 워터마킹 (v5.3 신규)

-   **목적:** 유출 방지가 아닌 **유출 시 책임 추적**을 위한 억제책.
-   **Seed 생성:** 서버는 `SHA256(userId + videoId + deviceId)`를 통해 추적이 가능하지만 개인정보는 직접 노출되지 않는 `watermarkSeed`를 생성하여 키/라이선스와 함께 전달한다.
-   **클라이언트 렌더링:** 플레이어는 비디오 위에 별도의 HTML `<canvas>` 또는 `<div>` 레이어를 생성하고, 전달받은 `seed`와 현재 시간 등을 조합하여 반투명 워터마크를 동적으로 렌더링한다. 이는 비디오 데이터 자체를 수정하지 않으므로 성능 저하가 거의 없다.
-   **위험 적응형 강도:** 서버는 재생 요청 시 사용자의 계정 상태 등을 판단하여 `watermarkMode`('normal' | 'aggressive')를 함께 전달할 수 있다. 클라이언트는 이 모드에 따라 워터마크의 투명도, 반복 빈도, 이동 속도를 조절하여 UX와 보안의 균형을 맞춘다.
-   **오프라인 강제 적용:** 오프라인 재생 시에는 워터마크 렌더링 실패를 치명적인 오류로 간주하여, 즉시 재생을 중단하고 `error-fatal` 상태로 전환한다.

---

## 4. 최종 Player State Machine (v5.3)

오프라인 관련 상태가 추가되어 모든 재생 시나리오에 대응한다.

```typescript
type PlayerState =
  | 'idle'
  // Online
  | 'requesting-key'    // 온라인 세션 키 요청
  | 'downloading'         // (온라인) 오프셋 맵 또는 청크 다운로드
  | 'buffering-seek'      // (온라인) 탐색 후 버퍼링
  // Offline
  | 'offline-downloading' // 오프라인용 파일 다운로드 중
  | 'offline-ready'       // 오프라인 파일 재생 준비 완료
  | 'offline-playing'     // 오프라인 재생 중
  // Common
  | 'decrypting'          // (Worker) 복호화 진행 중
  | 'ready'               // 재생 가능 (버퍼 데이터 충분)
  | 'playing'             // (온라인) 재생 중
  | 'paused'
  | 'recovering'          // (온라인) 네트워크/청크 자동 복구 시도
  | 'error-fatal'         // 복구 불가 오류
  | 'error-retryable'     // 사용자 재시도 가능 오류
  | 'license-expired';    // 오프라인 라이선스 만료
```

---

## 5. 장애 시나리오 및 UX 전략 (v5.3 기준)

**원칙:** ① 무한 로딩 절대 금지 ② 항상 명확한 상태 피드백 ③ 자동 복구 우선, 실패 시 명확한 행동 유도

| 장애 유형 | 시나리오 | 감지 위치 | 사용자 UX | PlayerState | 자동 대응 (v5.3) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **스트리밍** | 단일 청크 손상 | Worker (decrypt) | 🔄 “데이터 복구 중…” | `recovering` | 해당 청크 최대 2회 재요청 |
| | 청크 복구 최종 실패 | Main Thread | ❌ “파일 일부가 손상됨” | `error-fatal` | 재생 중단 |
| **네트워크** | Signed URL 만료 | Worker (fetch) | 🔄 “연결 갱신 중…” | `recovering` | 새 URL/키 자동 재발급 |
| **암호화/키**| **키 스코프 불일치** | **Worker (시작 시)** | ❌ “잘못된 재생 권한” | **`error-fatal`** | **즉시 중단 (키 오용)** |
| **오프라인**| **라이선스 만료** | **Player (시작 시)** | ⏰ “오프라인 시청 기간 만료” | **`license-expired`** | **재생 차단, 재다운로드 안내** |
| | 저장 공간 부족 | `saveVideo` | 💾 “기기 저장 공간 부족” | `error-retryable`| 다운로드 중단 |
| | **워터마크 렌더 실패** | Player (UI) | ❌ “보안 모듈 오류” | **`error-fatal`** | **(오프라인 시) 즉시 중단** |

---

## 6. 보안 경계 선언 (Security Boundary)

-   **본 시스템이 방어하는 것 (DEFENDED):**
    -   **키 재사용 방지:** 온라인/오프라인 키의 명확한 스코프 분리.
    -   **파일 공유 무력화:** 다운로드된 `.lsv` 파일은 해당 기기의 라이선스 없이는 무의미함.
    -   **라이선스 복제 방지:** 라이선스가 디바이스 ID에 바인딩됨.
    -   **대규모 자동 추출 억제:** 모든 접근은 인증 및 단기 유효 토큰/URL을 요구함.
    -   **유출 시 책임 추적:** 동적 워터마크를 통해 유출자 식별 가능성을 제공함.

-   **본 시스템이 방어하지 않는 것 (NOT DEFENDED):**
    -   **화면 녹화 (Screen Recording):** 브라우저 레벨에서 화면 녹화를 원천적으로 막을 수 없음 (이는 상용 DRM의 영역).
    -   **메모리 덤프 공격 (Memory Dump):** 숙련된 공격자가 브라우저 메모리를 분석하여 복호화된 비디오 프레임이나 세션 키를 탈취할 가능성을 배제할 수 없음.
    -   **루팅/탈옥 기기에서의 보호:** 변조된 운영체제 환경에서의 보안을 보장하지 않음.

**결론:** v5.3은 상용 DRM 솔루션을 도입하기 전, 웹 표준 기술(Web Crypto, IndexedDB) 내에서 구현할 수 있는 최고 수준의 **보안 억제책(Deterrent)** 이다.
---

## 부록 A: v5.3 구현 잠금 (Implementation Lock)

**본 문서는 AI가 v5.3을 구현할 때 발생할 수 있는 모든 해석, 추정, 생략을 금지하기 위한 구현 잠금 문서(Implementation Lock)이다. 이 문서의 규칙은 상위 모든 설명보다 우선하며, 위반은 버그로 간주한다.**

### A. 오프라인 재생 Seek 처리 규칙 (절대 변경 불가)

#### A-1. 오프라인 Seek의 정의
- 오프라인 재생은 네트워크를 절대 사용하지 않는다
- HTTP Range 요청 금지
- 청크 재요청 / 재시도 로직 금지

#### A-2. Seek 동작 규칙
오프라인 Seek 시 반드시 다음 순서를 따른다:
1.  **Chunk Offset Map 재사용**: 다운로드 시 생성된 Offset Map을 그대로 사용. 재계산 금지.
2.  **Worker 내부 상태 리셋**:
    - 현재 decrypt 큐 즉시 중단
    - 기존 appendBuffer 작업 즉시 중단
3.  **메모리 내 ArrayBuffer 슬라이싱**:
    - .lsv ArrayBuffer에서 `offsetMap[targetChunkIndex]` 범위만 slice
4.  **복호화 재시작**:
    - 단일 청크 단위 복호화
    - 실패 시 즉시 error-fatal

#### A-3. 금지 사항
- ❌ 온라인 스트리밍 로직 재사용
- ❌ fetch / retry / backoff 호출
- ❌ recovering 상태 진입

**오프라인 Seek 실패는 항상 치명적 오류(error-fatal)이다.**

### B. 워터마크 렌더링 실패 정의 (명시적)

다음 중 하나라도 발생하면 워터마크 렌더링 실패로 간주한다.

#### B-1. 실패 조건
- watermarkSeed가 존재하지 않음
- `<canvas>` 또는 `<div>` 오버레이 생성 실패
- 렌더 루프(requestAnimationFrame) 2회 연속 중단
- opacity / position 갱신 실패
- visibility 변경 후 워터마크 미복구

#### B-2. 대응 규칙
- **온라인 재생**: warning 로그 + 재시도 1회
- **오프라인 재생**: 즉시 error-fatal

**워터마크는 UX 요소가 아닌 보안 컴포넌트로 취급한다.**

### C. 오프라인 라이선스 시간 조작 방지 규칙 (필수)

#### C-1. 필수 필드
오프라인 라이선스 객체는 반드시 다음 필드를 포함한다:
```json
{
  "expiresAt": number,
  "issuedAt": number,
  "lastCheckedAt": number
}
```

#### C-2. 검증 규칙 (모두 강제)
- `now < issuedAt` → `error-fatal`
- `now < lastCheckedAt` → `error-fatal`
- `now > expiresAt` → `license-expired`

#### C-3. `lastCheckedAt` 갱신
- 재생 종료 시
- 일시정지 후 재개 시
- 앱 포그라운드 복귀 시

**시스템 시간 롤백 감지는 선택 사항이 아니라 필수 보안 규칙이다.**

### D. IndexedDB 저장 형식 강제

#### D-1. 저장 금지
- ❌ 평문 비디오 데이터
- ❌ raw secret key
- ❌ scope 없는 라이선스

#### D-2. 저장 허용 형식
- `.lsv` → 암호문 ArrayBuffer 그대로
- `key` → CryptoKey 또는 wrappedKey
- `license` → 구조화 객체 + signature(optional)

#### D-3. 로드 시 검증
- `scope` 불일치 → 즉시 `error-fatal`
- `deviceId` 불일치 → 즉시 `error-fatal`

### E. AI 구현 일반 금지 규칙

AI는 다음 행동을 절대 하지 않는다:
- “더 나은 UX”를 이유로 보안 규칙 완화
- 네트워크 오류를 오프라인에서 복구 시도
- 워터마크 실패를 무시하고 재생 지속
- `error-fatal`을 `error-retryable`로 downgrade

### F. 최종 선언

본 문서(v5.3 + Appendix)는 비-DRM 환경에서 더 이상 개선이나 확장이 필요 없는 최종 상태로 간주한다.
이후 변경은 상용 DRM 도입 시점에서만 허용된다.

**본 문서 위반 = 보안 결함**

---
📌 **AI 최종 명령 (요약)**

“이 문서를 구현하되, 해석하지 말고 그대로 실행하라.
누락·완화·재해석은 모두 오류다.”
