
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
// [핵심 변경 1] 존재하지 않는 'firebase' 대신 'enableFirebaseTelemetry'를 가져옵니다.
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

// [핵심 변경 2] 플러그인 배열 안이 아니라, 밖에서 함수를 실행하여 모니터링을 활성화합니다.
enableFirebaseTelemetry();

export const ai = genkit({
  plugins: [
    googleAI(),
    // [핵심 변경 3] 에러를 일으키던 firebase() 플러그인은 삭제했습니다.
  ],
});
