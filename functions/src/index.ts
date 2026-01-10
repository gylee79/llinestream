import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

// 0. 초기화
if (!getApps().length) initializeApp();
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 1. Genkit 설정
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-1.5-flash"),
});

// 2. [Flow 정의] AI 분석 로직 (Brain)
const VideoAnalysisSchema = z.object({
  transcript: z.string(),
  summary: z.string(),
  timeline: z.array(z.object({ timestamp: z.string(), event: z.string(), visualDetail: z.string() })),
  visualCues: z.array(z.string()),
  keywords: z.array(z.string()),
});

export const videoAnalysisFlow = ai.defineFlow(
  {
    name: 'videoAnalysisFlow',
    inputSchema: z.object({ fileUri: z.string(), mimeType: z.string() }),
    outputSchema: VideoAnalysisSchema,
  },
  async (input) => {
    const { output } = await ai.generate({
      prompt: [
        { text: "Analyze this video file comprehensively based on the provided JSON schema." },
        { media: { url: input.fileUri, contentType: input.mimeType } }
      ],
      output: { schema: VideoAnalysisSchema },
    });
    if (!output) throw new Error('AI Output is null');
    return output;
  }
);

// 3. [Trigger 정의] 파일 업로드 감지 및 실행 (Action)
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 3600,
    memory: "2GiB",
  },
  async (event) => {
    const change = event.data;
    if (!change || !change.after.data()) return;
    const after = change.after.data();
    const before = change.before.data();

    // 상태 관리 (무한 루프 방지)
    if (after.aiProcessingStatus === "pending") {
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }
    if (after.aiProcessingStatus !== "processing") return;
    if (before?.aiProcessingStatus === "processing") return;

    // 파일 처리 준비
    const filePath = after.filePath;
    if (!filePath) return;

    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempPath = path.join(os.tmpdir(), `vid_${event.params.episodeId}`);
    let uploadedFileId = "";

    try {
      console.log(`🚀 Start Analysis: ${event.params.episodeId}`);
      await getStorage().bucket().file(filePath).download({ destination: tempPath });
      
      const mimeType = filePath.endsWith('mp4') ? "video/mp4" : "video/quicktime"; // 간단 처리
      const uploadResult = await fileManager.uploadFile(tempPath, { mimeType, displayName: event.params.episodeId });
      uploadedFileId = uploadResult.file.name;

      // Gemini 처리 대기
      let state = uploadResult.file.state;
      while (state === FileState.PROCESSING) {
        await new Promise(r => setTimeout(r, 5000));
        state = (await fileManager.getFile(uploadedFileId)).state;
      }
      if (state === FileState.FAILED) throw new Error("Gemini File Processing Failed");

      // ★ Genkit Flow 호출
      console.log("🎥 Calling Genkit Flow...");
      const result = await videoAnalysisFlow({ fileUri: uploadResult.file.uri, mimeType });

      // 결과 저장
      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: `Summary: ${result.summary}`,
        updatedAt: new Date()
      });
      console.log("✅ Analysis Completed!");

    } catch (e) {
      console.error("❌ Error:", e);
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: String(e) });
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      if (uploadedFileId) try { await fileManager.deleteFile(uploadedFileId); } catch {}
    }
  }
);
