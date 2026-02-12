# LlineStream System Spec v1
(Fail-Fast + Deep Debugging + Deterministic Implementation)
1️⃣ 시스템 철학 (Design Principles)
✅ 1. Fail-Fast

하나라도 실패하면 즉시 전체 실패

중간 단계 우회 없음

성공한 것만 다음 단계로 전달

✅ 2. Single Source of Truth

상태는 오직 episodes.status와 jobs로만 판단

파생 상태 필드 금지

✅ 3. Deterministic (추측 금지)

암호화 포맷, 파일명, 세그먼트 인덱스, AAD 규칙 모두 고정

개발 AI가 임의 변경 불가

✅ 4. Deep Debugging

실패 시 원인 1초 안에 파악 가능해야 함

모든 실패는 Debug Bundle 생성

2️⃣ 전체 흐름 (High-Level Flow)
Upload → Job 생성 → Video Pipeline → Verify → Keys → Completed
        → AI Job → AI 분석 → Completed


모든 실행은 Job 기반

Storage/Firestore 트리거 직접 실행 금지

실행은 반드시 Queue → Worker 방식

3️⃣ 핵심 상수 (Immutable Constants)
ALGO_SEGMENT = AES-256-GCM
KEY_LEN = 32 bytes
IV_LEN = 12 bytes
TAG_LEN = 16 bytes

ENC_FILE_FORMAT = [IV(12)][CIPHERTEXT][TAG(16)]

AAD_MODE = "path"
AAD_VALUE = utf8("path:" + encryptedSegmentStoragePath)

SEGMENT_DURATION_SEC = 4
SEGMENT_INDEX_START = 1

VERIFY_TARGET = init + first + middle + last

KEK_SECRET_ENCODING = base64
KEK_VERSION = 1

VIDEO_PIPELINE.maxAttempts = 2
AI_ANALYSIS.maxAttempts = 3

WATCHDOG_STALE_MINUTES = 15

4️⃣ Firestore 스키마 (절대 변경 금지)
episodes/{episodeId}
4.1 status (비디오 파이프라인)
status: {
  pipeline: "queued" | "processing" | "failed" | "completed",
  step: "validate" | "ffmpeg" | "encrypt" | "verify" | "manifest" | "keys" | "done",
  playable: boolean,
  progress: number,
  jobId: string,
  startedAt: timestamp,
  updatedAt: timestamp,
  lastHeartbeatAt: timestamp,
  error: {
    step: string,
    code: string,
    message: string,
    hint: string,
    raw: string,
    debugLogPath: string,
    ts: timestamp
  }
}

4.2 storage
storage: {
  rawPath: string,
  encryptedBasePath: string,      // episodes/{id}/segments/
  manifestPath: string,
  aiAudioPath: string,
  thumbnailBasePath: string
}

4.3 encryption
encryption: {
  algorithm: "AES-256-GCM",
  ivLength: 12,
  tagLength: 16,
  keyId: string,
  kekVersion: 1,
  aadMode: "path",
  segmentDurationSec: 4,
  fragmentEncrypted: true
}

4.4 ai
ai: {
  status: "queued" | "processing" | "failed" | "completed" | "blocked",
  jobId: string,
  model: string,
  attempts: number,
  lastHeartbeatAt: timestamp,
  error: {
    code: string,
    message: string,
    raw: string,
    debugLogPath: string,
    ts: timestamp
  },
  resultPaths: {
    transcript: string,
    summary: string,
    chapters: string,
    quiz: string
  }
}

jobs/{jobId}
jobs: {
  type: "VIDEO_PIPELINE" | "AI_ANALYSIS",
  episodeId: string,
  status: "queued" | "running" | "failed" | "succeeded" | "dead",
  attempts: number,
  maxAttempts: number,
  createdAt: timestamp,
  startedAt: timestamp,
  finishedAt: timestamp,
  lastHeartbeatAt: timestamp,
  error: { code, message, raw, ts }
}

5️⃣ Job Lock 규칙 (중복 실행 절대 금지)
Worker 시작 시:

트랜잭션으로 jobs.status = running

이미 running/succeeded/failed면 즉시 종료

episodes.status.pipeline == processing AND jobId 다르면 즉시 종료

6️⃣ Video Pipeline 단계별 계약
Step 1 — validate (ffprobe)

ffprobe.json 저장

실패 시:

pipeline=failed

error.step="validate"

Step 2 — ffmpeg
반드시 수행:

2-Pass Encoding

DASH segmentation

segmentDuration=4

init.mp4 + segment_%d.m4s

thumbnail/preview 생성

HQ Audio 192k 생성

aiAudioPath 저장

실패 시:

pipeline=failed

error.step="ffmpeg"

Step 3 — encrypt

입력:

init.mp4
segment_%d.m4s


출력:

init.enc
segment_%d.m4s.enc


포맷:

[IV][CIPHERTEXT][TAG]


AAD:

utf8("path:" + storagePath)

Step 4 — verify (Self-Verify)

검증:

init

first

middle

last

복호화 성공해야 통과

실패:

error.code = DECRYPT_CHECK_FAILED

Step 5 — manifest

manifest.json 생성

실패 시 전체 실패

Step 6 — keys

masterKey = randomBytes(32)

KEK(base64 decode)

encryptedMasterKeyBlob = [IV][CIPHERTEXT][TAG]

video_keys 저장

kekVersion=1

Step 7 — 완료
episodes.status.pipeline = completed
episodes.status.playable = true
progress = 100

7️⃣ Fail-Fast 정책

아래 단계 중 하나라도 실패 시:

validate

ffmpeg

encrypt

verify

manifest

keys

즉시:

pipeline = failed
playable = false
error 기록
job 종료


Raw 아카이브 실패는:

✅ 정책 A (선택됨): 경고만 남기고 completed 유지

8️⃣ Debug Bundle 계약

저장 경로:

logs/{episodeId}/{jobId}/


파일 목록:

ffprobe.json

ffmpeg_command.txt

ffmpeg_stderr_tail.txt

env.json

verify_report.json

Firestore 연결:

episodes.status.error.debugLogPath

9️⃣ AI Analyzer 계약
Guard 조건 (모두 만족해야 시작)

pipeline == completed

playable == true

manifestPath 존재

aiAudioPath 존재

미충족 시:

ai.status = blocked
ai.error.code = AI_GUARD_BLOCKED

AI 처리

maxAttempts = 3

실패 시 attempts++

성공 시 resultPaths 저장

완료 시 ai.status=completed

🔟 Watchdog (Stuck 처리)

Scheduler: 5분마다

조건:

jobs.status == running
AND now - lastHeartbeatAt > 15분


처리:

jobs.status = failed (JOB_TIMEOUT)
episodes.status.pipeline = failed

1️⃣1️⃣ Implementation Checklist (코딩 AI용 최종 체크리스트)

 Firestore 스키마 정확히 구현

 Job Lock 트랜잭션 구현

 status.step/progress/heartbeat 업데이트 구현

 Fail-fast 즉시 종료 구현

 Segment 암호화 포맷 정확히 구현

 AAD(path) 정확히 적용

 Self-Verify 구현

 Debug Bundle 5종 생성

 KEK base64 decode 고정

 AI Guard 4조건 구현

 Watchdog 구현

🎯 최종 결론

이 문서 상태면:

코딩 AI가 추측할 영역 거의 없음

암호화/세그먼트/상태머신 혼선 없음

실패 원인 1초 내 확인 가능

운영 중 무한 processing 재발 방지

KEK 변경 사고 방지 12️⃣ Offline 다운로드 계약 (Secure Offline Contract v1)
12.1 목표

오프라인 저장은 허용

하지만:

사용자 + 디바이스에 강하게 바인딩

만료 기간 강제

위조 방지

서버 검증 가능한 구조

12.2 Offline License 스펙 (절대 변경 금지)
발급 API
POST /api/offline-license

입력
{
  "videoId": string,
  "deviceId": string
}

License Payload 구조 (JWT or Signed JSON)
{
  "videoId": string,
  "userId": string,
  "deviceId": string,
  "issuedAt": timestamp,
  "expiresAt": timestamp,
  "keyId": string,
  "kekVersion": number,
  "policy": {
    "maxDevices": number,
    "allowScreenCapture": false
  }
}

필수 조건

서버 개인키로 서명 (Ed25519 또는 RSA)

클라이언트는 공개키로 서명 검증

expiresAt 지나면 재생 차단

deviceId 불일치 시 재생 차단

12.3 Offline 키 파생 규칙 (고정)

Derived Key는 masterKey를 직접 주지 않는다.

파생 방식 (HKDF)
derivedKey = HKDF(
  masterKey,
  salt = SHA256(userId + deviceId),
  info = videoId + expiresAt
)


결과 길이: 32 bytes

AES-256-GCM 복호화용 키로 사용

12.4 Offline 저장 구조 (IndexedDB)
OfflineVideoData {
  episodeId,
  manifest,
  encryptedSegments: Map<path, ArrayBuffer>,
  license,
  downloadedAt
}


⚠️ 주의:

세그먼트는 암호화된 상태 그대로 저장

복호화 키는 메모리에서만 사용

localStorage에 키 저장 금지

12.5 Offline Guard 조건

재생 전 반드시 검증:

현재 시간 < expiresAt

deviceId 일치

license 서명 유효

keyId 일치

불일치 시:

OFFLINE_LICENSE_INVALID

13️⃣ 워터마크 계약 (Dynamic Forensic Watermark v1)
13.1 목표

화면 녹화/불법 공유 시 사용자 추적 가능

원본 영상은 변형하지 않음

사용자마다 고유 식별

13.2 Watermark Seed 생성 규칙 (서버)
생성식 (고정)
watermarkSeed = SHA256(
  userId + "|" + videoId + "|" + deviceId + "|" + sessionId
)


64 hex string

play-session 또는 offline-license 발급 시 함께 반환

13.3 온라인 재생 시 계약

/api/play-session 응답에 포함:

{
  "derivedKeyB64": "...",
  "watermarkSeed": "...",
  "expiresAt": timestamp
}

13.4 워터마크 렌더링 규칙 (클라이언트 고정)

위치: 랜덤 3~6개

opacity: 0.05 ~ 0.15

회전: -15deg

간격 주기적 재배치 (30~60초마다)

pointer-events: none

CSS z-index: video 위

13.5 오프라인 재생 시

offline license에 포함된 userId/deviceId 기반으로 동일 seed 생성

seed는 서버가 주거나, 동일 알고리즘으로 재생성 가능

13.6 워터마크 보안 규칙

seed는 절대 manifest에 저장하지 않음

seed는 세션 기반

로그에 seed 직접 저장 금지 (필요 시 hash만)

14️⃣ 오프라인 + 워터마크 통합 흐름

온라인:

/api/play-session
→ derivedKey
→ watermarkSeed
→ CDN fetch encrypted segments
→ decrypt in Worker
→ render watermark overlay


오프라인:

/api/offline-license
→ signed license + expiresAt
→ derivedKey HKDF
→ save encrypted segments
→ playback with license validation
→ render watermark

15️⃣ Offline/Watermark 체크리스트 (코딩 AI용)

 License는 반드시 서버 서명

 deviceId mismatch 차단

 HKDF 파생 정확히 구현

 세그먼트는 암호화 상태 유지

 복호화 키는 메모리에만 존재

 watermarkSeed는 세션 기반 생성

 30~60초마다 위치 재랜덤

 expiresAt 초과 시 재생 차단
