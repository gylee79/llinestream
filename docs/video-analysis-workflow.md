# 최종 비디오 AI 분석 및 채팅 워크플로우

**목표:** 비디오 등록 시, Firebase Cloud Function이 자동으로 AI 분석을 수행하고, 분석된 데이터를 Firestore의 **두 가지 형태**로 저장합니다. 사용자는 이 데이터를 기반으로 AI 튜터와 영상 내용에 대해 깊이 있는 대화를 나눌 수 있습니다.

**핵심 데이터 전략:**

1.  **개별 분석:** 각 영상의 상세 분석(요약, 대본 등)은 해당 영상 문서(`episodes/{id}`)에 저장하여 영상 자체의 정보를 풍부하게 합니다.
2.  **중앙화된 검색용 데이터:** **동일한 분야(Field)에 속하는 모든 영상의 AI 분석 요약본**을 별도의 중앙 컬렉션(`episode_ai_chunks`)에 저장합니다. AI 튜터는 이 중앙 저장소에서 사용자의 질문과 관련된 모든 영상 내용을 검색하여 종합적인 답변을 제공합니다.

---

## Part 1. 비디오 등록 및 자동 AI 분석 (백엔드)

관리자가 비디오를 업로드하면, 다음 과정이 자동으로 진행됩니다.

### Step 1: 업로드 및 트리거 (클라이언트 → Firestore)
1.  **파일 업로드:** 관리자가 '비디오 업로드' 페이지에서 영상 파일과 각종 정보를 입력하고 저장합니다.
2.  **Storage 저장:** 비디오와 썸네일 파일은 **Firebase Storage**의 `episodes/{episodeId}/...` 경로에 안전하게 저장됩니다.
3.  **메타데이터 저장:** 영상의 제목, 설명, 파일 경로 등 모든 정보가 Firestore의 `episodes` 컬렉션에 새 문서로 생성됩니다. 이때 **`aiProcessingStatus: 'pending'`** 상태가 함께 저장됩니다. 이것이 AI 분석 워크플로우를 시작하는 "방아쇠" 역할을 합니다.

### Step 2: Cloud Function 실행 및 AI 분석 (백엔드)
1.  **자동 트리거:** `episodes` 컬렉션에 `pending` 상태의 새 문서가 감지되면, **v1 Cloud Function (`analyzeVideoOnWrite`)** 이 자동으로 실행됩니다.
2.  **상태 변경:** 함수는 즉시 해당 에피소드 문서의 상태를 `'processing'`으로 변경하여 중복 작업을 방지합니다.
3.  **AI 분석 요청:** Storage에 저장된 비디오 파일을 `gemini-2.5-pro` 모델로 전달하여 **구조화된 JSON 데이터**(대본, 요약, 타임라인, 키워드 등)를 요청합니다.

### Step 3: 분석 결과 저장 (백엔드)
AI 분석이 완료되면, Cloud Function은 Firestore에 **두 종류의 데이터**를 저장합니다.

1.  **개별 에피소드 문서 업데이트 (`episodes/{episodeId}`):**
    *   `transcript`: 영상의 전체 음성 대본
    *   `aiGeneratedContent`: AI가 생성한 요약 및 키워드 정보
    *   `vttPath`: 생성된 자막 파일의 Storage 경로
    *   `aiProcessingStatus`: 'completed'로 최종 변경

2.  **중앙 검색용 데이터 생성 (`episode_ai_chunks/{episodeId}`):**
    *   에피소드의 요약/키워드(`aiGeneratedContent`)를 포함한 문서를 생성합니다.
    *   이 문서에는 상위 계층 정보인 `fieldId`, `classificationId`, `courseId`가 함께 저장됩니다.
    *   AI 튜터는 이 컬렉션을 `fieldId`로 검색하여, **같은 분야의 모든 영상 내용을 한 번에 파악**할 수 있습니다.

---

## Part 2. AI 채팅 (사용자)

사용자가 영상을 보면서 AI 튜터에게 질문을 합니다.

### Step 1: 질문하기 (클라이언트 → Genkit 플로우)
*   사용자가 채팅창에 질문을 입력하면, 에피소드 ID와 질문 내용이 `askVideoTutor` Genkit AI 플로우로 전달됩니다.

### Step 2: 컨텍스트 검색 및 답변 생성 (백엔드)
1.  **관련 분야 찾기:** 플로우는 먼저 에피소드 ID를 통해 해당 에피소드가 속한 **분야(Field) ID**를 찾습니다.
2.  **중앙 저장소 검색:** `episode_ai_chunks` 컬렉션에서 **동일한 `fieldId`를 가진 모든 문서의 `content`를 가져와** 하나의 거대한 컨텍스트로 합칩니다.
3.  **답변 생성:** 이 종합 컨텍스트와 사용자 질문을 `gemini-2.5-pro` 모델에 함께 전달하여, **현재 영상뿐만 아니라 같은 분야의 다른 영상 내용까지 참고한 깊이 있는 답변**을 생성합니다.

### Step 3: 응답 및 기록 저장
*   생성된 답변은 사용자 화면에 표시됩니다.
*   모든 대화 내용은 `users/{userId}/chats` 와 `chat_logs` 컬렉션에 안전하게 기록됩니다.

---

## 데이터 저장 위치 요약

| 데이터 종류 | 저장 위치 (Firebase) | 설명 |
| :--- | :--- | :--- |
| **비디오/썸네일/자막 파일** | **Storage** | `episodes/{episodeId}/...` 경로에 원본 파일 저장 (비공개) |
| **개별 영상 분석 결과** | **Firestore** (`episodes/{episodeId}`) | 영상의 대본(transcript), AI 요약본(aiGeneratedContent) 등 |
| **AI 검색용 중앙 데이터** | **Firestore** (`episode_ai_chunks/{episodeId}`) | 분야(fieldId)별 검색을 위한 AI 요약본 모음 |
| **AI 채팅 기록** | **Firestore** (`users/{userId}/chats` 및 `chat_logs`) | 개인용/관리자용 채팅 기록 |
