
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
// [핵심 변경 1] 존재하지 않는 'firebase' 대신 'enableFirebaseTelemetry'를 가져옵니다.
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

// [핵심 변경 2] 플러그인 배열 안이 아니라, 밖에서 함수를 실행하여 모니터링을 활성화합니다.
enableFirebaseTelemetry();

// [핵심 변경 3] genkit()의 결과를 export하여 다른 파일에서 재사용합니다.
export const ai = genkit({
  plugins: [
    googleAI({
      // Gemini 1.5 Flash 모델을 지정합니다.
      apiVersion: "v1beta",
    }),
    // [핵심 변경 4] 에러를 일으키던 firebase() 플러그인은 삭제했습니다.
  ],
});
