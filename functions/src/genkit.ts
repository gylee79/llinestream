import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { firebase } from '@genkit-ai/firebase';

export function initializeGenkit() {
  genkit({
    plugins: [
      firebase(),
      googleAI({
        // Gemini 2.5 Flash 모델을 지정합니다.
        // Genkit 및 Google AI 플러그인 버전에 따라 모델 이름이 달라질 수 있습니다.
        // 예: 'gemini-1.5-flash-latest' 또는 다른 이름
      }),
    ],
    logSinks: ['firebase'],
    enableTracingAndMetrics: true,
  });
}
