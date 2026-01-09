import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

if (!getApps().length) {
  initializeApp();
}

const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"), 
});

const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('The full and accurate audio transcript of the video.'),
  summary: z.string().describe('A concise summary of the entire video content.'),
  timeline: z.array(z.object({
    timestamp: z.string().describe('The timestamp of the event in HH:MM:SS format.'),
    event: z.string().describe('A description of what is happening at this timestamp.'),
    visualDetail: z.string().describe('Notable visual details, like objects or character appearances.'),
  })).describe('An array of time-stamped logs detailing events throughout the video.'),
  visualCues: z.array(z.string()).describe('A list of important on-screen text (OCR) or significant visual objects.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords for searching and tagging.'),
});

export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) return;

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
      const bucketName = getStorage().bucket().name;
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
      if (!result) throw new Error("No output from AI");

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

    } catch (error) {
      console.error("❌ Error:", error);
      await snapshot.ref.update({ 
        aiProcessingStatus: "failed", 
        aiProcessingError: String(error) 
      });
    }
  }
);
