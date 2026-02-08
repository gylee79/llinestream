# [최신] 비디오 처리, 보안 재생 및 오프라인 워크플로우

**목표:** 관리자가 비디오를 업로드하는 순간부터 최종 사용자가 온라인/오프라인에서 안전하게 시청하기까지의 전 과정을 자동화하고, 강력한 이중 암호화 및 워터마크 기술로 콘텐츠를 보호하는 서버리스 파이프라인입니다.

**기술 스택:**
- **AI 모델:** Google Gemini 1.5 Flash
- **파일 암호화 (1차):** AES-256-GCM (파일 전체 암호화)
- **세션 키 암호화 (2차):** HMAC-SHA256 (사용자별 임시 키 생성)
- **실행 환경:** Firebase Cloud Functions (v2)
- **데이터베이스:** Firestore
- **파일 저장소:** Firebase Storage
- **클라이언트 DB:** IndexedDB (오프라인 저장용)

---

## Part 1. 비디오 업로드 및 자동 처리 (관리자)

관리자가 비디오를 업로드하면, 아래 과정이 백그라운드에서 자동으로 진행됩니다.

1.  **메타데이터 입력 및 파일 선택 (`video-upload-dialog.tsx`)**
    관리자가 '비디오 업로드' 대화상자에서 제목, 설명, 강좌 분류 등을 입력하고 비디오 원본 파일, 썸네일 파일 등을 선택합니다.

2.  **파일 업로드 및 정보 저장 (`upload-episode.ts`)**
    `saveEpisodeMetadata` 서버 액션이 호출됩니다. 이 액션은 브라우저가 직접 Firebase Storage에 비디오와 썸네일 파일을 업로드하도록 지시합니다. 업로드가 완료되면 반환된 파일 경로와 URL, 그리고 입력된 모든 메타데이터를 Firestore의 `episodes` 컬렉션에 저장합니다. 이때 **`status.processing: 'pending'`** 상태로 저장되어 백엔드 프로세스를 깨웁니다.

3.  **백엔드 프로세스 트리거 (`functions/src/index.ts`)**
    Firestore에 `pending` 상태의 새 에피소드 문서가 생성되면, 이를 감지하는 Cloud Functions의 `onDocumentWritten` 트리거가 자동으로 실행됩니다. 함수는 즉시 상태를 `'processing'`으로 변경하여 중복 실행을 방지합니다.

4.  **AI 분석 및 암호화 병렬 처리 (`functions/src/index.ts`)**
    Cloud Function 내에서 두 가지 핵심 작업이 `Promise.allSettled`를 통해 동시에 시작됩니다.
    *   **작업 A: AI 콘텐츠 분석 (`runAiAnalysis`):**
        *   **기술:** Google Gemini 1.5 Flash, Google AI File Manager
        *   **과정:** 원본 비디오 파일을 Google AI 서버에 업로드하고, "이 비디오를 분석하여 요약, 전체 대본, 시간대별 자막/설명이 포함된 타임라인을 한국어 JSON으로 만들어줘" 라고 구조화된 데이터 출력을 요청합니다.
        *   **결과:** AI가 생성한 결과물 중, 용량이 큰 **`transcript`(대본)는 별도의 `.txt` 파일**로, `timeline` 데이터는 **`.vtt` 자막 파일로 변환**하여 각각 Storage에 저장합니다. 대본을 제외한 나머지 분석 결과(요약, 타임라인 등)는 JSON 문자열 형태로 Firestore 문서의 `aiGeneratedContent` 필드에 저장됩니다.

    *   **작업 B: 파일 암호화 (`createEncryptedFile`) - 1차 암호화:**
        *   **기술:** Node.js `crypto` 모듈, AES-256-GCM
        *   **과정:**
            1. 비디오 파일 하나당 유일무이한 **`마스터 암호화 키`(AES-256)**를 생성합니다.
            2. 마스터 키를 사용하여 원본 비디오 파일을 스트림 방식으로 완전히 암호화하고, 암호화된 데이터는 `.lsv` 확장자로 Firebase Storage의 **비공개(private) 경로**에 저장합니다.
            3. 생성된 **마스터 키는 절대로 `episodes` 문서에 저장하지 않고**, 서버에서만 접근 가능한 별도의 컬렉션인 **`video_keys`에 안전하게 보관**합니다.

5.  **최종 결과 저장 및 정리**
    두 작업이 모두 완료되면, AI 분석 결과 파일 경로(`transcriptPath`, `subtitlePath`), 암호화된 비디오 파일 경로(`storage.encryptedPath`) 및 메타데이터(`encryption` 객체)를 모두 Firestore의 해당 에피소드 문서에 업데이트하고 상태를 `'completed'`로 변경합니다. 마지막으로, 더 이상 필요 없는 원본 비디오 파일을 Storage에서 삭제하여 저장 공간을 절약하고 보안을 강화합니다.

---

## Part 2. 보안 온라인 스트리밍 (사용자)

사용자가 영상을 재생하면, 아래의 이중 암호화 해제 과정이 실시간으로 진행됩니다.

1.  **보안 URL 발급 요청 (`video-player-dialog.tsx` → `api/video-url`)**
    사용자가 재생 버튼을 누르면, 클라이언트는 서버의 `/api/video-url` 엔드포인트에 `videoId`와 **Firebase 인증 토큰**을 전송합니다. 서버는 사용자의 구독 권한을 확인한 후, 비공개 암호화 파일(`.lsv`)에 5분간 접근할 수 있는 **서명된 URL(Signed URL)**을 생성하여 클라이언트에 전달합니다.

2.  **재생 세션 및 임시 키 요청 (`video-player-dialog.tsx` → `api/play-session`)**
    URL을 받은 클라이언트는 즉시 서버의 `/api/play-session` 엔드포인트로 `videoId`와 `deviceId`를 전송하여 재생 세션을 시작하겠다고 요청합니다.

3.  **세션 키(Derived Key) 생성 (서버) - 2차 암호화**
    서버는 요청을 받고 `video_keys` 비밀 금고에서 해당 비디오의 **'마스터 키'**를 꺼냅니다. 그리고 `사용자 ID`와 `기기 ID` 등 고유 정보를 조합하여 **HMAC-SHA256 해시**를 적용, **오직 이 사용자, 이 기기, 이 세션에서만 사용 가능한 일회성 `세션 키(Derived Key)`**를 생성하여 클라이언트에 전달합니다.

4.  **실시간 복호화 및 재생 (클라이언트, `video-player-dialog.tsx`)**
    *   **기술:** Media Source Extensions (MSE), Web Crypto API (`crypto.subtle.decrypt`)
    *   **과정:**
        1. 클라이언트는 발급받은 서명된 URL을 통해 암호화된 `.lsv` 비디오 파일을 다운로드하기 시작합니다.
        2. 비디오 데이터가 들어오는 대로, 클라이언트는 방금 받은 **세션 키**를 사용하여 JavaScript Crypto API로 암호화된 데이터를 **실시간으로 풀면서(복호화)** `MediaSource` 버퍼에 주입합니다.
        3. HTML5 `<video>` 요소는 버퍼에 주입된 데이터를 일반 비디오처럼 재생합니다. 이 모든 복잡한 과정은 백그라운드에서 순식간에 일어나므로 사용자는 인지하지 못합니다.

---

## Part 3. 보안 오프라인 다운로드 및 재생 (사용자)

1.  **오프라인 라이선스 요청 (`video-player-dialog.tsx` → `api/offline-license`)**
    사용자가 다운로드 버튼을 클릭하면, 클라이언트는 서버의 `/api/offline-license` 엔드포인트로 `videoId`와 `deviceId`를 전송합니다.

2.  **오프라인 키 생성 (서버)**
    서버는 구독 권한을 확인하고 마스터 키를 가져옵니다. 이번에는 **만료 시간(예: 7일 후)을 포함**하여 `HMAC(마스터키, 사용자ID|기기ID|비디오ID|**만료타임스탬프**)` 방식으로 **오프라인용 세션 키**를 생성합니다.

3.  **라이선스 발급**
    서버는 생성된 `오프라인용 세션 키`, `만료 시간`, `워터마크 시드`를 포함한 **오프라인 라이선스**를 클라이언트에 전달합니다.

4.  **다운로드 및 저장 (클라이언트, `lib/offline-db.ts`)**
    클라이언트는 `/api/video-url`을 통해 서명된 URL을 받아, 암호화된 `.lsv` 파일 전체를 다운로드합니다. 다운로드한 **암호화된 비디오 데이터**와 **오프라인 라이선스**를 함께 브라우저의 `IndexedDB`에 안전하게 저장합니다.

5.  **오프라인 재생 (클라이언트, `downloads/page.tsx`)**
    사용자가 오프라인 상태에서 다운로드한 영상을 재생하면, 앱은 `IndexedDB`에서 암호화된 비디오와 오프라인 라이선스를 불러옵니다. 재생 전, 현재 시간이 라이선스에 저장된 `만료 시간`을 지났는지 확인합니다. 만료되지 않았다면, 저장된 `오프라인용 세션 키`를 사용하여 비디오 데이터를 실시간으로 복호화하며 재생합니다.

---

## Part 4. 워터마크 처리 방식

*   **시드 생성:** 온라인/오프라인 키를 발급할 때, 서버는 `사용자 ID`를 해싱하여 고유한 **`워터마크 시드`** 문자열을 생성하여 키와 함께 전달합니다.
*   **동적 렌더링 (`video-player-dialog.tsx`):** 비디오 플레이어는 전달받은 `워터마크 시드`를 비디오 위에 여러 개 복제하여 희미하게, 그리고 불규칙하게 움직이는 오버레이로 표시합니다.
*   **목적:** 화면 녹화를 하더라도 누가 녹화했는지 식별할 수 있는 흔적을 남겨 콘텐츠를 보호합니다.

---
---

## 워크플로우 요약 (JSON)

```json
{
  "workflow": "LlineStream Video Processing & Playback",
  "version": "2.0-AES-GCM",
  "parts": [
    {
      "name": "Part 1: Video Upload & Backend Processing",
      "actor": "Admin",
      "steps": [
        {
          "step": 1,
          "description": "Admin inputs metadata and selects files in the UI.",
          "file": "src/components/admin/content/video-upload-dialog.tsx",
          "technicalDetails": {
            "action": "Calls 'saveEpisodeMetadata' Server Action."
          }
        },
        {
          "step": 2,
          "description": "Files are uploaded to Storage and metadata saved to Firestore.",
          "file": "src/lib/actions/upload-episode.ts",
          "technicalDetails": {
            "storageUpload": "Client-side upload using 'uploadFile' from 'src/firebase/storage/upload.ts'.",
            "firestoreWrite": "Creates 'episodes' document with 'status.processing' set to 'pending'."
          }
        },
        {
          "step": 3,
          "description": "Cloud Function is triggered by the new Firestore document.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "trigger": "Firestore onDocumentWritten for 'episodes/{episodeId}'.",
            "initialUpdate": "Sets 'status.processing' to 'processing'."
          }
        },
        {
          "step": 4,
          "description": "AI analysis and file encryption run in parallel.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "aiAnalysis": {
              "library": "@google/generative-ai",
              "model": "gemini-1.5-flash",
              "function": "runAiAnalysis",
              "output": "JSON summary, VTT subtitles, and a separate TXT transcript file."
            },
            "fileEncryption": {
              "library": "Node.js Crypto",
              "algorithm": "AES-256-GCM",
              "function": "createEncryptedFile",
              "output": "A single encrypted '.lsv' file.",
              "keyManagement": "Master key is stored in a separate, secure 'video_keys' Firestore collection."
            }
          }
        },
        {
          "step": 5,
          "description": "Results from both processes are saved to the episode document.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "updatedFields": ["storage.encryptedPath", "encryption", "status.playable", "aiGeneratedContent", "subtitlePath", "transcriptPath"]
          }
        }
      ]
    },
    {
      "name": "Part 2: Encrypted Video Playback (Online)",
      "actor": "User",
      "steps": [
        {
          "step": 6,
          "description": "Client requests a short-lived signed URL for the encrypted file.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "api": "/api/video-url",
            "authentication": "Sends Firebase Auth ID Token to prove identity."
          }
        },
        {
          "step": 7,
          "description": "Client requests a temporary session key for decryption.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "api": "/api/play-session",
            "payload": "{ videoId, deviceId }"
          }
        },
        {
          "step": 8,
          "description": "Server generates and returns a session-specific derived key and watermark seed.",
          "file": "src/app/api/play-session/route.ts",
          "technicalDetails": {
            "keyDerivation": "HMAC-SHA256(masterKey, userId|deviceId)",
            "authorization": "Checks user's subscription status in Firestore."
          }
        },
        {
          "step": 9,
          "description": "Player decrypts and plays the video in real-time.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "decryption": "Uses Web Crypto API (AES-GCM) with the derived key.",
            "playback": "Feeds decrypted data chunks into a MediaSource buffer attached to an HTML5 <video> element."
          }
        }
      ]
    }
  ]
}
```
