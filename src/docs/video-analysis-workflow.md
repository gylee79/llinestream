# [공식] 비디오 처리 및 보안 스트리밍 워크플로우 (v6.0 - fMP4)

**목표:** 업계 표준인 **fMP4(Fragmented MP4)** 와 **MSE(Media Source Extensions)** 기술을 도입하여, 안정적이고 효율적인 보안 스트리밍 아키텍처를 완성한다. 이전 버전의 1MB 청크 방식은 폐기한다.

---

## 1. 아키텍처 개요

v6.0은 비디오를 스트리밍에 최적화된 여러 개의 **세그먼트(조각)**로 분할하고, 각 조각을 개별적으로 암호화하여 전송하는 방식을 채택한다. 클라이언트는 이 조각들을 순서대로 받아 즉시 해독하고 재생하여, 전체 파일을 다운로드하지 않고도 빠른 재생 시작과 탐색(Seeking)이 가능하다.

```
[비디오 업로드 (모든 포맷)]
         |
         ↓ (Cloud Function)
[1. ffmpeg 변환] → H.264/AAC 코덱의 fMP4 파일 생성
         |
         ↓
[2. 세그먼트 분할] → init.mp4 + media_xxx.mp4 (4초 단위)
         |
         ↓
[3. 개별 암호화] → 각 세그먼트 파일을 AES-256-GCM으로 암호화
         |
         ↓
[4. 스토리지 저장] → /episodes/{id}/[init.enc, segment_xxx.enc, manifest.json]
         |
         +---- [5. manifest.json 생성] : 코덱 정보, 세그먼트 목록 저장
```

---

## 2. 서버 측 처리 파이프라인 (Cloud Function)

`functions/src/index.ts`의 `analyzeVideoOnWrite` 함수가 모든 것을 관장한다.

### 2.1. `ffmpeg` 변환 및 분할 (2-Pass 방식)
- **1단계 (변환):** 업로드된 모든 영상은 **`ffmpeg`** 을 통해 브라우저 호환성이 가장 높은 `H.264 (Baseline Profile)` 비디오 코덱과 `AAC` 오디오 코덱으로 변환된다. 이때 `-movflags frag_keyframe+empty_moov` 옵션을 사용하여, 스트리밍에 필수적인 단일 fMP4 구조를 생성한다. 키프레임 간격은 `-g 48 -keyint_min 48 -sc_threshold 0` 옵션으로 고정하여 시간 정확도를 보장한다.
- **2단계 (분할):** 변환된 fMP4 파일을 다시 `ffmpeg`의 `segment` 기능을 통해 **초기화 세그먼트(init.mp4)**와 **4초 단위의 미디어 세그먼트(segment_xxx.mp4)** 들로 안전하게 분할한다. 이 방식은 첫 세그먼트가 항상 `moov` 박스를 포함하는 순수한 `init` 세그먼트임을 보장한다.

### 2.2. 세그먼트 단위 암호화

| 항목 | 명세 | 설명 |
| :--- | :--- | :--- |
| **암호화 단위** | 파일 전체 | 개별 `init.mp4` 또는 `segment_xxx.mp4` 파일 하나가 암호화의 최소 단위. |
| **알고리즘** | `AES-256-GCM` | 데이터 암호화와 무결성 검증을 동시에 수행하는 표준 알고리즘. |
| **구조** | `[IV][암호화된 데이터 + 인증 태그]` | IV(12바이트)를 파일 맨 앞에 붙여, 복호화 시 쉽게 추출할 수 있도록 함. |
| **처리 위치** | 서버 (Cloud Function) | 클라이언트는 암호화 키를 알 필요가 없음. |
| **복호화 위치** | 클라이언트 (Web Worker) | 메인 스레드의 부하를 줄이고 안전하게 복호화 수행. |


### 2.3. Manifest.json 생성
모든 세그먼트 처리가 완료되면, 플레이어에게 재생 정보를 제공하기 위한 `manifest.json` 파일을 생성한다.
```json
{
  "codec": "video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"",
  "init": "episodes/{id}/init.enc",
  "segments": [
    { "path": "episodes/{id}/segment_0000.enc" },
    { "path": "episodes/{id}/segment_0001.enc" }
  ]
}
```
**중요:** `codec` 문자열은 `ffmpeg` 변환 후 `ffprobe`로 실제 생성된 파일에서 동적으로 추출하여 기록한다. 절대 하드코딩하지 않는다.

---

## 3. 클라이언트 측 재생 로직 (스트리밍)

`video-player-dialog.tsx` 컴포넌트가 재생 로직의 핵심이다.

1.  **세션 및 Manifest 요청:**
    -   플레이어는 서버(`/api/play-session`)에 **임시 세션 키**를 요청한다.
    -   동시에 `manifest.json` 파일의 임시 URL을 요청하여 내용을 가져온다.

2.  **미디어 소스 초기화:**
    -   브라우저의 `MediaSource` API를 사용하여 비디오 엘리먼트에 연결한다.
    -   **규칙:** `manifest.json`에 명시된 **코덱(codec) 문자열**이 브라우저에서 지원되는지 `MediaSource.isTypeSupported()`로 **반드시 확인한 후** `addSourceBuffer`를 호출한다.

3.  **초기화 세그먼트 주입 (필수 선행 작업):**
    -   `init.enc` 파일의 URL을 요청하여 암호화된 데이터를 가져온다.
    -   웹 워커(**`crypto.worker.ts`**)로 보내 즉시 해독한다.
    -   **절대 규칙:** 해독된 `init` 데이터를 `SourceBuffer`에 **가장 먼저 `appendBuffer`** 한다.

4.  **미디어 세그먼트 순차 주입 (동기화 보장):**
    -   **절대 규칙:** `init` 세그먼트 주입이 완료(`updateend` 이벤트 발생)될 때까지 기다린다.
    -   `manifest.json`의 목록에 따라 첫 번째 미디어 세그먼트(`segment_0000.enc`)를 요청한다.
    -   가져온 암호화된 세그먼트를 웹 워커로 보내 해독한다.
    -   **절대 규칙:** 이전 작업이 완료(`updateend` 이벤트)된 것을 확인한 후, 해독된 데이터를 `SourceBuffer`에 `appendBuffer` 한다.
    -   **이 과정을 모든 세그먼트에 대해 순차적으로 반복한다.**

5.  **스트림 종료:**
    -   마지막 세그먼트의 `append`가 완료되면, `sourceBuffer.updating`이 `false`이고 `mediaSource.readyState`가 `open`인지 확인한 후, `mediaSource.endOfStream()`을 호출하여 스트림을 안전하게 종료한다.

---

## 4. 오프라인 저장 및 재생

-   **저장:** '오프라인 저장' 시, `manifest.json`과 그 안에 명시된 모든 세그먼트 파일(`init.enc`, `segment_xxx.enc`)을 다운로드하여 **IndexedDB**에 저장한다.
-   **재생:** 오프라인 재생 시, 네트워크 요청 대신 IndexedDB에서 세그먼트 파일들을 순서대로 읽어와 온라인 스트리밍과 **동일한 MSE 주입 로직**으로 재생한다.

---

## 5. 결론

v6.0 아키텍처는 미디어 컨테이너 구조(fMP4)와 암호화 단위(세그먼트)를 일치시키고, MSE API의 `updateend` 이벤트를 통해 주입 순서를 엄격히 제어함으로써, **정석적인 보안 스트리밍 방식**을 구현한다. 이를 통해 'Failed to fetch', 'SourceBuffer' 관련 오류를 근본적으로 해결하고 안정적인 비디오 재생을 보장한다.
