# 비디오 AI 분석 워크플로우 (v2 - 자동화)

**목표:** 비디오가 Firestore에 등록되는 순간, Firebase Cloud Functions와 Genkit을 사용하여 백그라운드에서 자동으로 AI 분석을 수행하고 결과를 저장하는 서버리스 파이프라인.

**기술 스택:**
- **프레임워크:** Genkit 1.0 (Node.js)
- **AI 모델:** Google Gemini 2.5 Flash
- **실행 환경:** Firebase Cloud Functions (2nd Gen)
- **트리거:** Firestore Trigger (`onDocumentCreated`)
- **스토리지:** Firebase Storage

---

### Step 1: 영상 업로드 및 메타데이터 저장 (클라이언트)

1.  **파일 선택 (관리자 페이지):**
    *   관리자가 '비디오 업로드' 대화상자에서 비디오 파일, 썸네일, 제목, 설명 등의 정보를 입력합니다.

2.  **Storage에 직접 업로드:**
    *   '저장' 버튼을 클릭하면, 브라우저(클라이언트)가 Firebase 클라이언트 SDK를 사용해 비디오와 썸네일 파일을 **직접 Firebase Storage에 업로드**합니다.
    *   이 방식은 Next.js 서버 메모리를 전혀 사용하지 않아 안전합니다.

3.  **서버 액션 호출:**
    *   파일 업로드가 완료되면, 클라이언트는 Storage로부터 받은 파일의 공개 `downloadUrl`과 `filePath`를 포함한 모든 메타데이터를 가지고 `saveEpisodeMetadata` 서버 액션을 호출합니다.

4.  **Firestore 문서 생성:**
    *   `saveEpisodeMetadata` 액션은 전달받은 모든 정보와 함께 **`aiProcessingStatus: 'pending'`** 상태를 포함하여 Firestore의 `episodes` 컬렉션에 새 문서를 생성합니다.
    *   **핵심:** 이 단계에서 서버 액션의 역할은 데이터를 저장하는 것으로 끝나며, 무거운 AI 분석 작업은 시작하지 않습니다.

---

### Step 2: Cloud Function 트리거 및 실행 (백엔드)

1.  **자동 트리거 (`functions/src/index.ts`):**
    *   `episodes` 컬렉션에 `aiProcessingStatus: 'pending'` 상태의 새 문서가 생성되는 이벤트를 감지하는 **Firestore 트리거(`onDocumentCreated`)**가 자동으로 실행됩니다.

2.  **상태 업데이트:**
    *   Cloud Function이 시작되면, 즉시 해당 에피소드 문서의 `aiProcessingStatus`를 `'processing'`으로 변경하여 중복 실행을 방지하고 현재 상태를 명확히 합니다.

---

### Step 3: Genkit을 이용한 AI 분석 (백엔드 - Cloud Function 내부)

1.  **파일 스트리밍 다운로드:**
    *   메모리 폭발을 방지하기 위해, 에피소드 문서에 저장된 `filePath`를 이용해 Firebase Storage에서 비디오 파일을 Cloud Function의 **임시 로컬 디렉토리로 스트리밍하여 다운로드**합니다.

2.  **Genkit으로 AI 분석 요청:**
    *   다운로드된 임시 파일을 Genkit의 `ai.generate()` 함수에 입력으로 전달합니다.
    *   **`gemini-2.5-flash`** 모델이 비디오를 분석하고, 미리 정의된 Zod 스키마에 따라 **구조화된 JSON 데이터** (`transcript`, `visualSummary`, `keywords`)를 반환합니다.

---

### Step 4: 결과 저장 및 정리 (백엔드)

1.  **결과 저장:**
    *   AI가 반환한 `transcript`, `visualSummary`, `keywords`를 조합하여 Firestore 문서의 `transcript`, `aiGeneratedContent` 필드를 업데이트합니다.
    *   `aiProcessingStatus`를 **`completed`**로 변경하여 분석이 성공적으로 완료되었음을 표시합니다.

2.  **에러 처리:**
    *   분석 과정 중 에러가 발생하면, `aiProcessingStatus`를 `'failed'`로, `aiProcessingError`에 오류 메시지를 기록합니다.

3.  **리소스 정리:**
    *   성공/실패 여부와 관계없이, Cloud Function의 임시 디렉토리에 다운로드했던 비디오 파일을 삭제하여 리소스를 깨끗하게 정리합니다.

