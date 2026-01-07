import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { firebase } from '@genkit-ai/firebase';
export function initializeGenkit() {
    genkit({
        plugins: [
            firebase(),
            googleAI({
                // Gemini 1.5 Flash 모델을 지정합니다.
                apiVersion: "v1beta",
            }),
        ],
        logSinks: ['firebase'],
        enableTracingAndMetrics: true,
    });
}
//# sourceMappingURL=genkit.js.map