# 스트리밍 파이프라인 진단 로그 가이드

이 문서는 비디오 업로드부터 재생까지 전 과정에 걸쳐 출력되는 상세 로그를 해석하는 방법을 안내합니다. 문제가 발생했을 때 이 로그를 통해 원인을 신속하게 파악할 수 있습니다.

---

## 1. 서버 측 로그 (Cloud Functions)

비디오가 업로드되면 Cloud Functions에서 **AI 분석**과 **암호화** 작업이 수행됩니다. 이 과정은 Firebase Console의 Functions 로그에서 확인할 수 있습니다.

### 1.1. FFmpeg 명령어 확인

`ffmpeg`를 통해 비디오를 fMP4로 변환하고 세그먼트로 분할할 때 실행되는 실제 커맨드를 확인할 수 있습니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 🚀 FFMPEG TRANSCODE COMMAND: ffmpeg -i /tmp/lline-in-xxx/original_video ... -movflags frag_keyframe+empty_moov ... /tmp/lline-in-xxx/frag.mp4
[<EPISODE_ID>] 🚀 FFMPEG SEGMENT COMMAND: ffmpeg -i /tmp/lline-in-xxx/frag.mp4 ... -f segment ... /tmp/lline-out-xxx/segment_%04d.mp4
```
- **확인 포인트:** `TRANSCODE` 명령어에 `-movflags frag_keyframe+empty_moov` 옵션이 포함되어 있는지, `SEGMENT` 명령어가 실행되는지 확인합니다.

---

### 1.2. 세그먼트 생성 및 구조 분석

세그먼트 분할 작업이 끝난 직후, 실제로 생성된 파일 목록을 출력하여 구조를 검증합니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 🔎 Segment file structure analysis: [ 'segment_0000.mp4', 'segment_0001.mp4', 'segment_0002.mp4' ]
[<EPISODE_ID>] ✅ Init segment found: segment_0000.mp4
[<EPISODE_ID>] ✅ Renamed segment_0000.mp4 to init.mp4.
```
- **확인 포인트:** `segment_xxxx.mp4` 형태의 파일들이 생성되었는지, 그 중 첫 번째 파일이 `init.mp4`로 정상적으로 이름이 변경되었는지 확인합니다.

---

### 1.3. 암호화 크기 비교

각 세그먼트 파일을 암호화할 때 원본 크기와 암호화 후의 크기를 비교하여 출력합니다. 암호화 오버헤드(IV 12바이트 + 인증 태그 16바이트)로 인해 암호화 후 크기가 약간 더 커져야 정상입니다.

**✅ 정상 로그 예시:**
```log
[<EPISODE_ID>] 📦 Segment 'init.mp4' | Original Size: 844 bytes -> Encrypted Size: 872 bytes
[<EPISODE_ID>] 📦 Segment 'segment_0001.mp4' | Original Size: 642387 bytes -> Encrypted Size: 642415 bytes
```
- **확인 포인트:** `Encrypted Size`가 `Original Size`보다 정확히 **28바이트** 큰지 확인합니다.

---

## 2. 웹 워커 로그 (Browser Console)

클라이언트의 백그라운드 스레드에서 암호 해독이 성공했는지 확인합니다. 브라우저 개발자 도구의 콘솔에서 볼 수 있습니다.

**✅ 정상 로그 예시:**
```log
[Worker] ✅ Decryption success for requestId <REQUEST_ID>. First 8 bytes (hex): 00 00 00 18 66 74 79 70
```
- **확인 포인트:**
  - `Decryption success` 메시지가 출력되는지 확인합니다.
  - `init` 세그먼트의 경우, `hex` 값이 **`00 00 00 18 66 74 79 70`** (ASCII로 `....ftyp`) 또는 유사한 MP4 시그니처로 시작하는지 확인합니다. 이는 해독된 데이터가 유효한 MP4 파일임을 나타내는 결정적인 증거입니다.

---

## 3. 클라이언트 플레이어 로그 (Browser Console)

플레이어가 서버로부터 데이터를 받아와 MediaSource에 주입하는 과정을 추적합니다. 브라우저 개발자 도구의 콘솔에서 볼 수 있습니다.

**✅ 정상 로그 예시 (순서대로 출력):**
```log
🔌 MediaSource state: open
[0] ➡️ Fetching segment: episodes/<ID>/init.enc
[Worker] ✅ Decryption success...
[0] 🟢 Appending segment...
[0] ✅ Append complete. Buffered: start: 0, end: 4.004
🔌 MediaSource state: open
[1] ➡️ Fetching segment: episodes/<ID>/segment_0000.enc
[Worker] ✅ Decryption success...
[1] 🟢 Appending segment...
[1] ✅ Append complete. Buffered: start: 0, end: 8.008
🔌 MediaSource state: open
[2] ➡️ Fetching segment: episodes/<ID>/segment_0001.enc
... (이하 반복) ...
🏁 All segments appended. Ending stream.
```
- **확인 포인트:**
  1. `MediaSource state`가 `open`으로 시작하는가?
  2. `init.enc`를 가장 먼저 `Fetching` 하는가?
  3. `Appending segment...` 로그가 `Decryption success...` 로그 직후에 나타나는가?
  4. `Append complete` 로그와 함께 `Buffered`의 `end` 시간이 점차 증가하는가?
  5. 모든 세그먼트가 추가된 후 `Ending stream` 메시지가 나타나는가?

이 로그들을 순서대로 확인하면 어느 단계에서 문제가 발생하는지 정확히 진단할 수 있습니다.
