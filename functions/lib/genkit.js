"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeGenkit = initializeGenkit;
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const firebase_1 = require("@genkit-ai/firebase");
function initializeGenkit() {
    (0, genkit_1.genkit)({
        plugins: [
            (0, firebase_1.firebase)(),
            (0, google_genai_1.googleAI)({
                // Gemini 1.5 Flash 모델을 지정합니다.
                apiVersion: "v1beta",
            }),
        ],
        logSinks: ['firebase'],
        enableTracingAndMetrics: true,
    });
}
//# sourceMappingURL=genkit.js.map