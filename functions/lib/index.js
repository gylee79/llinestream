"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeVideoOnWrite = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
// 1. API Key 비밀 설정
const apiKey = (0, params_1.defineSecret)("GOOGLE_GENAI_API_KEY");
// 2. Genkit 초기화
// (변수 대신 문자열로 모델을 직접 지정해서 에러 원천 차단)
const ai = (0, genkit_1.genkit)({
    plugins: [(0, google_genai_1.googleAI)()],
    model: google_genai_1.googleAI.model("gemini-2.5-flash"),
});
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)({
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
}, async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot)
        return;
    const data = snapshot.data();
    // 상태가 'processing'이 아니면 무시
    if (data?.status !== "processing" || !data?.transcript) {
        return;
    }
    console.log("🚀 Gemini 2.5 Analysis Started:", event.params.episodeId);
    try {
        // 3. AI 분석 요청
        const llmResponse = await ai.generate({
            prompt: [
                { text: "Analyze this transcript and summarize it." },
                { text: data.transcript }
            ],
            output: {
                format: "json",
                schema: genkit_1.z.object({
                    transcript: genkit_1.z.string(),
                    visualSummary: genkit_1.z.string(),
                    keywords: genkit_1.z.array(genkit_1.z.string()),
                }),
            },
        });
        // 4. 성공 시 Firestore 업데이트
        await snapshot.ref.update({
            status: "completed",
            analysis: llmResponse.output,
        });
        console.log("✅ Analysis Finished!");
    }
    catch (error) {
        console.error("❌ Error:", error);
        await snapshot.ref.update({ status: "error", error: String(error) });
    }
});
//# sourceMappingURL=index.js.map