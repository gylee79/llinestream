
# 스트리밍 파이프라인 진단 로그 가이드 (v2)

이 문서는 비디오 업로드부터 재생까지 전 과정에 걸쳐 출력되는 상세 로그를 해석하는 방법을 안내합니다. 문제가 발생했을 때 이 로그를 통해 원인을 신속하게 파악할 수 있습니다.

---

## 1. 서버 측 로그 (Cloud Functions)

비디오가 업로드되면 Cloud Functions에서 **AI 분석**과 **암호화** 작업이 수행됩니다. 이 과정은 Firebase Console의 Functions 로그에서 확인할 수 있습니다.

### 1.1. FFmpeg 명령어 확인

`ffmpeg`를 통해 비디오를 fMP4로 변환하고 세그먼트로 분할할 때 실행되는 실제 커맨드를 확인할 수 있습니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 🚀 FFMPEG TRANSCODE COMMAND: ffmpeg -i /tmp/lline-in-xxx/original_video ... -movflags frag_keyframe+empty_moov ... -g 48 ... /tmp/lline-in-xxx/frag.mp4
[<EPISODE_ID>] 🚀 FFMPEG SEGMENT COMMAND: ffmpeg -i /tmp/lline-in-xxx/frag.mp4 ... -f segment ... /tmp/lline-out-xxx/segment_%04d.mp4
```
- **확인 포인트:**
    - **TRANSCODE 명령어:** `-movflags frag_keyframe+empty_moov` 옵션과 `-g 48` 같은 GOP 고정 옵션이 포함되어 스트리밍에 최적화된 파일이 생성되는지 검증합니다.
    - **SEGMENT 명령어:** 변환된 fMP4 파일을 대상으로 `-f segment` 옵션을 사용해 분할하는지 확인합니다.

### 1.2. 코덱 문자열 실제 검증

`ffmpeg` 변환 후, `ffprobe`를 통해 실제 생성된 비디오의 코덱 정보를 추출합니다. 이 코덱 문자열은 `manifest.json`에 저장되어 클라이언트가 사용합니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 💡 Detected Codec String: video/mp4; codecs="avc1.42e01e, mp4a.40.2"
```
- **확인 포인트:** 여기서 추출된 코덱 문자열이 클라이언트의 `MediaSource.isTypeSupported()` 검사를 통과해야 합니다. 이 값이 잘못되면 `addSourceBuffer` 단계에서 오류가 발생합니다.

### 1.3. 세그먼트 생성 및 구조 분석

세그먼트 분할 작업이 끝난 직후, 실제로 생성된 파일 목록을 출력하여 구조를 검증합니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 🔎 Segment file structure analysis: [ 'segment_0000.mp4', 'segment_0001.mp4', 'segment_0002.mp4' ]
[<EPISODE_ID>] ✅ Renamed segment_0000.mp4 to init.mp4.
```
- **확인 포인트:** `segment_xxxx.mp4` 형태의 파일들이 생성되었는지, 그 중 첫 번째 파일이 `init.mp4`로 정상적으로 이름이 변경되었는지 확인합니다.

### 1.4. 암호화 크기 비교

각 세그먼트 파일을 암호화할 때 원본 크기와 암호화 후의 크기를 비교하여 출력합니다. 암호화 오버헤드(IV 12바이트 + 인증 태그 16바이트)로 인해 암호화 후 크기가 약간 더 커져야 정상입니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 📦 Segment 'init.mp4' | Original Size: 844 bytes -> Encrypted Size: 872 bytes
[<EPISODE_ID>] 📦 Segment 'segment_0001.mp4' | Original Size: 642387 bytes -> Encrypted Size: 642415 bytes
```
- **확인 포인트:** `Encrypted Size`가 `Original Size`보다 정확히 **28바이트** 큰지 확인합니다. (IV 12 + Tag 16)

---

## 2. 클라이언트 측 로그 (Browser Console)

브라우저 개발자 도구 콘솔에서 재생 과정의 상세 로그를 확인할 수 있습니다.

### 2.1. 네트워크 응답 검증 (Network 탭)

**가장 먼저 확인할 부분입니다.**
1.  **`manifest.json`, `init.enc` 요청:** `Status`가 **`200 OK`** 인지 확인합니다.
2.  **`segment_xxxx.enc` 요청:** `Status`가 **`200 OK` 또는 `206 Partial Content`** 인지 확인합니다.
    - **중요:** 클라이언트가 `Range` 헤더 없이 세그먼트 전체를 요청하는 경우 `200`은 정상입니다. `Range` 헤더와 함께 요청했는데도 `206`이 아닌 `200`이 온다면 CORS 설정 문제입니다.
3.  **응답 헤더 확인:** `segment_xxxx.enc` 요청을 클릭하고 `Response Headers` 탭에서 아래 헤더가 있는지 확인합니다.
    -   `Accept-Ranges: bytes`
    -   (206 응답 시) `Content-Range: bytes xxxx-yyyy/zzzz`

### 2.2. Web Worker 복호화 검증

백그라운드 스레드에서 암호 해독이 성공했는지 확인합니다.

**✅ 정상 로그 예시:**
```log
[Worker] ✅ Decryption success... First 8 bytes (hex): 00 00 00 18 66 74 79 70 | Init Segment Validation: ftyp=true, moov=true
```
- **확인 포인트:**
    - `Decryption success` 메시지가 출력되는지 확인합니다.
    - **(중요)** `init` 세그먼트의 경우, `hex` 값이 **`....ftyp`** 시그니처로 시작하고, **`moov=true`** 로그가 반드시 포함되는지 확인합니다. 이는 해독된 데이터가 재생 가능한 초기화 세그먼트임을 나타내는 결정적인 증거입니다.
- **❌ 오류 로그 예시:**
```log
[Worker] ❌ Decryption failed... Decryption failed in worker: The operation failed...
[Worker] ❌ Decryption Error Name: IntegrityError
```
 - **확인 포인트:** `error.name`이 `IntegrityError`라면, 암호화된 데이터가 변조되었거나 암호화에 사용된 키와 복호화 키가 일치하지 않음을 의미합니다.

### 2.3. 플레이어 재생 파이프라인 추적

플레이어가 데이터를 받아와 MediaSource에 주입하는 과정을 추적합니다.

**✅ 정상 로그 예시 (순서대로 출력):**
```log
🔌 MediaSource state: open
💡 Codec '...' is supported by this browser.
[0] ➡️ Fetching segment: episodes/<ID>/init.enc
...
[Worker] ✅ Decryption success...
sourceBuffer.updating: false
[0] 🟢 Appending segment...
[0] ✅ Append complete.
Buffered ranges:
  range 0: 0.000 ~ 4.004
New segment duration: 4.004s
... (이하 반복) ...
🏁 All segments appended. Ending stream.
🔌 MediaSource state: ended
```
- **확인 포인트:**
  1. `MediaSource state`가 `open`으로 시작하고 `ended`로 끝나는가?
  2. 코덱이 `is supported` 메시지와 함께 지원되는가?
  3. `init.enc`를 가장 먼저 `Fetching` 하는가?
  4. `sourceBuffer.updating`이 `false`인 상태에서 `Appending`이 시작되는가?
  5. `Append complete` 후 `Buffered ranges`의 끝 시간이 점차 증가하는가?
  6. `New segment duration`이 4초에 가까운가?

### 2.4. 타임스탬프 정렬 검증 (고급)

세그먼트가 시간 축 상에서 정확히 이어지는지 확인하여 `QuotaExceededError` 같은 미묘한 오류를 잡아냅니다.

**✅ 정상 로그 예시:**
```log
Timestamp Offset: 0
Current Time: 3.98
Buffered ranges:
  range 0: 0.000 ~ 4.004
  range 1: 4.004 ~ 8.008
```
- **확인 포인트:**
  - `Timestamp Offset`이 특별한 이유 없이 변경되지 않는가?
  - `Current Time`이 버퍼링된 범위 내에서 자연스럽게 흘러가는가?
  - `Buffered ranges`의 `end` 시간과 다음 `start` 시간이 거의 정확하게 일치하는가? (미세한 부동소수점 오차는 정상)

이 로그들을 순서대로 확인하면 어느 단계에서 문제가 발생하는지 정확히 진단할 수 있습니다.
