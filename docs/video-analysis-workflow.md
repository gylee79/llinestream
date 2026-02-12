
# [공식] 비디오 처리 및 보안 스트리밍 워크플로우 (v6.1 - DASH/fMP4)

**목표:** 업계 표준인 **fMP4(Fragmented MP4)** 와 **MSE(Media Source Extensions)** 기술을 도입하여, 안정적이고 효율적인 보안 스트리밍 아키텍처를 완성한다. 이전 버전의 1MB 청크 방식은 폐기한다.

---

## 1. 아키텍처 개요 (v6.1 기준)

v6.1은 비디오를 스트리밍에 최적화된 여러 개의 **세그먼트(조각)**로 분할하고, 각 조각을 개별적으로 암호화하여 전송하는 방식을 채택한다. 클라이언트는 이 조각들을 순서대로 받아 즉시 해독하고 재생하여, 전체 파일을 다운로드하지 않고도 빠른 재생 시작과 탐색(Seeking)이 가능하다.

```
[비디오 업로드 (모든 포맷)]
         |
         ↓ (Cloud Function)
[1. ffmpeg 변환] → H.264/AAC 코덱의 fMP4 파일 생성
         |
         ↓
[2. DASH 분할]   → init.mp4 + segment_*.m4s (4초 단위)
         |
         ↓
[3. 개별 암호화] → 각 세그먼트 파일을 AES-256-GCM으로 암호화
         |
         ↓
[4. 스토리지 저장] → /episodes/{id}/segments/[init.enc, segment_*.m4s.enc]
         |
         +---- [5. manifest.json 생성] : 코덱 정보, 세그먼트 목록 저장
```

---

## 2. 서버 측 처리 파이프라인 (Cloud Function)

`functions/src/index.ts`의 `videoPipelineTrigger` 함수가 모든 것을 관장한다.

### 2.1. `ffmpeg` 변환 및 분할 (2-Pass + DASH)
- **1단계 (변환):** 업로드된 모든 영상은 **`ffmpeg`** 을 통해 브라우저 호환성이 가장 높은 `H.264 (Baseline Profile)` 비디오 코덱과 `AAC` 오디오 코덱으로 변환된다. 이때 `-movflags frag_keyframe+empty_moov` 옵션을 사용하여, 스트리밍에 필수적인 단일 fMP4 구조를 생성한다.
- **2단계 (DASH 분할):** 1단계에서 생성된 `frag.mp4` 파일을 다시 `ffmpeg`의 `-f dash` 기능을 통해 **초기화 세그먼트(init.mp4)**와 **4초 단위의 미디어 세그먼트(segment_*.m4s)** 들로 안전하게 분할한다. v6.1부터는 안정성을 위해 `-c copy` 옵션을 제거하여, `ffmpeg`가 필요시 코덱을 재처리하도록 허용한다.

### 2.2. 세그먼트 단위 암호화
- **암호화 단위:** **파일 전체**를 하나의 암호화 단위로 취급한다.
- **암호화 방식:** 각 세그먼트 파일은 `AES-256-GCM` 알고리즘으로 암호화된다.
- **무결성 검증:** 암호화 시 `path:{storagePath}`를 AAD(Authenticated Additional Data)로 사용하여, 클라이언트에서 복호화할 때 데이터가 변조되지 않았는지 검증한다.
- **구조:** 암호화된 최종 파일은 `[IV (12바이트)][암호화된 데이터 + 인증 태그]` 구조를 가진다.

### 2.3. Manifest.json 생성
모든 세그먼트 처리가 완료되면, 플레이어에게 재생 정보를 제공하기 위한 `manifest.json` 파일을 생성한다.
```json
{
  "codec": "video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"",
  "duration": 725,
  "init": "episodes/{id}/segments/init.enc",
  "segments": [
    { "path": "episodes/{id}/segments/segment_1.m4s.enc" },
    { "path": "episodes/{id}/segments/segment_2.m4s.enc" }
  ]
}
```

---

## 3. 클라이언트 측 재생 로직 (스트리밍)

`video-player-dialog.tsx` 컴포넌트가 재생 로직의 핵심이다.

1.  **세션 및 Manifest 요청:**
    -   플레이어는 서버(`/api/play-session`)에 **세션용 암호 해독 키**(`masterKey`)를 요청한다.
    -   동시에 `manifest.json` 파일의 임시 URL을 요청하여 내용을 가져온다.

2.  **미디어 소스 초기화:**
    -   브라우저의 `MediaSource` API를 사용하여 비디오 엘리먼트에 연결한다.
    -   `manifest.json`에 명시된 **코덱(codec) 문자열**을 사용하여 `SourceBuffer`를 생성한다.

3.  **초기화 세그먼트 주입 (필수 선행 작업):**
    -   `init.enc` 파일의 URL을 요청하여 암호화된 데이터를 가져온다.
    -   웹 워커(**`crypto.worker.ts`**)로 보내 `masterKey`를 이용해 즉시 해독한다.
    -   해독된 `init` 데이터를 `SourceBuffer`에 **가장 먼저 `appendBuffer`** 한다.

4.  **미디어 세그먼트 순차 주입:**
    -   `init` 세그먼트 주입이 완료되면(`updateend` 이벤트), `manifest.json`의 목록에 따라 첫 번째 미디어 세그먼트(`segment_1.m4s.enc`)를 요청한다.
    -   가져온 암호화된 세그먼트를 웹 워커로 보내 해독한다.
    -   이전 주입이 완료되면, 해독된 데이터를 `SourceBuffer`에 `appendBuffer` 한다.
    -   **이 과정을 모든 세그먼트에 대해 순차적으로 반복**한다.

---

## 5. 결론

v6.1 아키텍처는 `ffmpeg`의 DASH 분할 과정에서 안정성을 높여, 다양한 비디오 소스에 대해 보다 견고한 스트리밍 파이프라인을 제공한다. MSE API의 요구사항을 충족하는 정석적인 보안 스트리밍 방식을 유지하며, 오류 발생 가능성을 줄이고 안정적인 비디오 재생을 보장한다.
