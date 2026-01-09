"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeVideoOnWrite = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const app_1 = require("firebase-admin/app");
const storage_1 = require("firebase-admin/storage");
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const apiKey = (0, params_1.defineSecret)("GOOGLE_GENAI_API_KEY");
const ai = (0, genkit_1.genkit)({
    plugins: [(0, google_genai_1.googleAI)()],
    model: google_genai_1.googleAI.model("gemini-2.5-flash"),
});
const AnalysisOutputSchema = genkit_1.z.object({
    transcript: genkit_1.z.string().describe('The full and accurate audio transcript of the video.'),
    summary: genkit_1.z.string().describe('A concise summary of the entire video content.'),
    timeline: genkit_1.z.array(genkit_1.z.object({
        timestamp: genkit_1.z.string().describe('The timestamp of the event in HH:MM:SS format.'),
        event: genkit_1.z.string().describe('A description of what is happening at this timestamp.'),
        visualDetail: genkit_1.z.string().describe('Notable visual details, like objects or character appearances.'),
    })).describe('An array of time-stamped logs detailing events throughout the video.'),
    visualCues: genkit_1.z.array(genkit_1.z.string()).describe('A list of important on-screen text (OCR) or significant visual objects.'),
    keywords: genkit_1.z.array(genkit_1.z.string()).describe('An array of relevant keywords for searching and tagging.'),
});
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)({
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 540,
    memory: "1GiB",
}, async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot)
        return;
    const data = snapshot.data();
    if (data?.aiProcessingStatus !== "processing") {
        return;
    }
    const filePath = data.filePath;
    if (!filePath) {
        console.error("No filePath found");
        return;
    }
    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);
    try {
        const bucketName = (0, storage_1.getStorage)().bucket().name;
        const gsUrl = `gs://${bucketName}/${filePath}`;
        console.log(`🎥 Analyzing Video via Direct URL: ${gsUrl}`);
        const llmResponse = await ai.generate({
            prompt: [
                { text: "Analyze this video file comprehensively based on the provided schema." },
                { media: { url: gsUrl } }
            ],
            output: {
                format: "json",
                schema: AnalysisOutputSchema,
            },
        });
        const result = llmResponse.output;
        if (!result)
            throw new Error("No output from AI");
        const combinedContent = `
Summary: ${result.summary}\n
Timeline:
${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n
Visual Cues: ${result.visualCues.join(', ')}\n
Keywords: ${result.keywords.join(', ')}
      `.trim();
        await snapshot.ref.update({
            aiProcessingStatus: "completed",
            transcript: result.transcript,
            aiGeneratedContent: combinedContent,
            aiProcessingError: null,
            updatedAt: new Date()
        });
        console.log("✅ Analysis Finished & Data Saved!");
    }
    catch (error) {
        console.error("❌ Error:", error);
        await snapshot.ref.update({
            aiProcessingStatus: "failed",
            aiProcessingError: String(error)
        });
    }
});
//# sourceMappingURL=index.js.map