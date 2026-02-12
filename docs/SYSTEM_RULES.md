# --- LlineStream 프로젝트 절대 규칙 ---

## 1. AI 모델 사용 규칙
- **모든 AI 기능은 반드시 `gemini-3-flash-preview` 모델을 사용해야 합니다.** 다른 모델 이름(`gemini-1.5-pro`, `gemini-3-preview` 등)은 절대 사용해서는 안 됩니다.

## 2. 보안 규칙 관련
- **개발 중 보안 규칙은 절대 수정하지 않습니다.** Firestore 및 Storage 보안 규칙은 사장님의 별도 지시가 있기 전까지, 모든 접근을 허용하는 **'개발용 오픈 상태'**를 유지해야 합니다.

## 3. 주요 기술 스택
- **프론트엔드:** Next.js, React, TypeScript
- **UI:** ShadCN, Tailwind CSS
- **백엔드 AI:** Genkit
- **데이터베이스:** Firestore
