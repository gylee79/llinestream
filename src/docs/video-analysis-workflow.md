# 비디오 AI 분석 및 채팅 워크플로우

**목표:** 비디오가 등록되는 순간, Firebase Cloud Functions와 Genkit을 사용하여 백그라운드에서 자동으로 AI 분석을 수행하고, 사용자는 분석된 데이터를 기반으로 AI와 대화하는 서버리스 파이프라인.

**기술 스택:**
- **AI 모델:** Google Gemini 2.5 Pro
- **AI 프레임워크:** Genkit
- **실행 환경:** Firebase Cloud Functions (v1)
- **트리거:** Firestore `onWrite`
- **데이터베이스:** Firestore
- **파일 저장소:** Firebase Storage

---

## Part 1. 자동 비디오 분석 (관리자)

관리자가 비디오를 업로드하면, 사용자의 개입 없이 다음 과정이 자동으로 진행됩니다.

### Step 1: 업로드 및 메타데이터 저장 (클라이언트 → 서버)
1.  **파일 업로드 (관리자 페이지):** 관리자가 '비디오 업로드' 대화상자에서 비디오 파일, 썸네일, 제목, 설명 등의 정보를 입력하고 저장합니다.
2.  **Storage에 직접 업로드:** 브라우저(클라이언트)가 Firebase 클라이언트 SDK를 사용해 비디오와 썸네일 파일을 **직접 Firebase Storage에 업로드**합니다. 이 방식은 서버 리소스를 사용하지 않아 효율적입니다.
3.  **메타데이터 저장 (서버 액션):** 파일 업로드 완료 후, 클라이언트는 파일의 공개 URL 및 경로를 포함한 모든 메타데이터를 `saveEpisodeMetadata` 서버 액션으로 전달합니다.
4.  **Firestore 문서 생성:** 서버 액션은 전달받은 정보를 Firestore의 `episodes` 컬렉션에 새 문서로 생성합니다. 이때 **`aiProcessingStatus: 'pending'`** 상태가 함께 저장됩니다. 이 상태가 전체 분석 워크플로우를 시작하는 "방아쇠" 역할을 합니다.

### Step 2: Cloud Function 트리거 및 실행 (백엔드)
1.  **자동 트리거 (`functions/src/index.ts`):** `episodes` 컬렉션에 `aiProcessingStatus: 'pending'` 상태의 새 문서가 생성되면, 이를 감지하는 **Firestore `onWrite` 트리거**가 Cloud Function을 자동으로 실행합니다.
2.  **상태 업데이트:** 함수가 시작되면, 즉시 해당 에피소드 문서의 `aiProcessingStatus`를 `'processing'`으로 변경하여 중복 실행을 방지하고 현재 상태를 명확히 합니다.

### Step 3: Genkit을 이용한 AI 분석 (백엔드 - Cloud Function 내부)
1.  **공개 URL 가져오기:** 함수는 에피소드 문서에 저장된 `videoUrl` (공개 URL)을 확보합니다. 만약 URL이 없다면, Storage 파일 경로(`filePath`)를 이용해 직접 공개 URL을 생성합니다.
2.  **구조화된 데이터 요청:** Genkit의 `ai.generate()` 함수를 호출하여 **`gemini-2.5-pro`** 모델에 비디오 분석을 요청합니다. 이때, 미리 정의된 Zod 스키마(`AnalysisOutputSchema`)를 함께 전달하여 AI가 다음과 같은 **구조화된 JSON 데이터**를 반환하도록 합니다.
    *   `transcript`: 영상의 전체 음성 대본
    *   `summary`: 영상 콘텐츠에 대한 간결한 요약
    *   `timeline`: 시간대별 주요 이벤트 및 시각적 상세 설명
    *   `visualCues`: 화면에 나타나는 중요한 텍스트(OCR) 또는 객체 목록
    *   `keywords`: 검색 및 태깅을 위한 핵심 키워드 배열

### Step 4: 결과 저장 및 관리 (백엔드)
1.  **분석 데이터 저장:** AI가 반환한 `transcript`와 나머지 분석 데이터(요약, 타임라인 등)를 조합한 `aiGeneratedContent`를 Firestore의 해당 에피소드 문서에 업데이트합니다.
2.  **상태 완료 처리:** `aiProcessingStatus`를 **`completed`**로 변경하여 분석이 성공적으로 완료되었음을 표시합니다. 분석 중 오류가 발생하면 `failed`로 변경하고 오류 메시지를 기록하여 관리자가 재시도할 수 있도록 합니다.
3.  **파일 관리:** 원본 비디오와 썸네일은 Firebase Storage에 그대로 유지됩니다. AI가 생성한 모든 텍스트 데이터(분석 결과)는 Firestore 문서 내에 직접 저장되므로, 별도의 분석 파일은 생성되지 않습니다.

---

## Part 2. AI 채팅 (사용자)

사용자가 영상을 보면서 질문하면, AI 튜터는 위에서 분석된 데이터를 기반으로 답변합니다.

### Step 1: 질문하기 (클라이언트)
1.  **질문 입력:** 사용자가 영상 플레이어의 채팅창에 궁금한 점을 입력하고 '전송' 버튼을 누릅니다.
2.  **서버로 전송:** 현재 시청 중인 에피소드의 ID(`episodeId`), 사용자 ID(`userId`), 그리고 질문 내용이 서버의 `askVideoTutor` AI 플로우로 전달됩니다.

### Step 2: 컨텍스트 기반 답변 생성 (백엔드 - Genkit 플로우)
1.  **분석 데이터 조회:** `askVideoTutor` 플로우는 전달받은 `episodeId`를 사용하여 Firestore에서 해당 에피소드의 **`aiGeneratedContent` 필드 값(Part 1에서 저장한 분석 데이터)**을 가져옵니다.
2.  **답변 범위:** AI 튜터는 **오직 이 `aiGeneratedContent` 데이터 안에서만** 답변의 근거를 찾습니다. 외부 인터넷 검색이나 다른 지식을 사용하지 않으므로, 영상 내용과 직접적으로 관련된 정확한 정보만 제공할 수 있습니다.
3.  **답변 생성:** 조회한 분석 데이터와 사용자 질문을 **`gemini-2.5-pro`** 모델에 함께 전달하여, 컨텍스트에 기반한 자연스러운 한국어 답변을 생성합니다.

### Step 3: 응답 및 기록 저장 (백엔드 → 클라이언트)
1.  **답변 표시:** 생성된 답변은 사용자 화면의 채팅창에 즉시 나타납니다.
2.  **채팅 기록 저장:** 질문과 답변 내용은 사용자의 개인 채팅 기록 컬렉션(`users/{userId}/chats/{chatId}`)에 저장됩니다. 이를 통해 사용자는 나중에 '기록 보기' 기능으로 과거 대화 내역을 다시 확인할 수 있습니다.
