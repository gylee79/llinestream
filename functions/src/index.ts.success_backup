import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

// 1. API Key 비밀 설정
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 2. Genkit 초기화
// (변수 대신 문자열로 모델을 직접 지정해서 에러 원천 차단)
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"), 
});

export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
  },
  async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) return;

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
          schema: z.object({
            transcript: z.string(),
            visualSummary: z.string(),
            keywords: z.array(z.string()),
          }),
        },
      } as any);

      // 4. 성공 시 Firestore 업데이트
      await snapshot.ref.update({
        status: "completed",
        analysis: llmResponse.output,
      });
      console.log("✅ Analysis Finished!");

    } catch (error) {
      console.error("❌ Error:", error);
      await snapshot.ref.update({ status: "error", error: String(error) });
    }
  }
);
