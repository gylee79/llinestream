import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager, FileState, FileMetadataResponse } from "@google/generative-ai/server";

// 0. Firebase Admin 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

// 1. Genkit 및 GoogleAIFileManager 초기화
const apiKey = process.env.GOOGLE_GENAI_API_KEY || '';
const ai = genkit({
  plugins: [googleAI({ apiKey })],
});
const fileManager = new GoogleAIFileManager(apiKey);

// 2. 전역 옵션 설정
setGlobalOptions({
  region: "asia-northeast3",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
});

// 3. Zod 스키마 정의
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

// 4. MIME Type 도우미
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".avi": return "video/x-msvideo";
    case ".wmv": return "video/x-ms-wmv";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    default: return "video/mp4";
  }
}

// ==========================================
// [Trigger] 파일 처리 및 AI 분석 실행
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    timeoutSeconds: 540,
    memory: "2GiB",
    region: "asia-northeast3",
    secrets: ["GOOGLE_GENAI_API_KEY"],
  }, 
  async (event) => {
    const change = event.data;
    if (!change) return;
    
    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted. Skipping analysis.`);
      return;
    }
    const afterData = change.after.data();
    if (!afterData) return;

    const beforeData = change.before.exists ? change.before.data() : null;
    const { episodeId } = event.params;

    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${episodeId}]. Setting status to 'processing'.`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }

    if (afterData.aiProcessingStatus !== "processing" || beforeData?.aiProcessingStatus === "processing") {
        return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
      console.error(`[${episodeId}] No filePath found.`);
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
      return;
    }
    
    console.log(`🚀 [${episodeId}] Starting secure video processing...`);
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    
    let uploadedFile: FileMetadataResponse | null = null;

    try {
      // 1. Download
      console.log(`[${episodeId}] Downloading from Storage: ${filePath}`);
      const bucket = admin.storage().bucket();
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      // 2. Upload to Google AI
      console.log(`[${episodeId}] Uploading to Google AI File Manager...`);
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Upload complete. Name: ${uploadedFile.name}, URI: ${uploadedFile.uri}`);

      // 3. Polling (대기)
      let state = uploadedFile.state;
      console.log(`⏳ [${episodeId}] Waiting for Gemini processing...`);
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... status: ${state}`);
      }

      if (state === FileState.FAILED) {
        throw new Error("Video processing failed by Google AI.");
      }

      // 4. Call Gemini
      console.log(`[${episodeId}] Calling Gemini 2.5 Flash...`);
      const { output } = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
          { media: { url: uploadedFile.uri, contentType: uploadedFile.mimeType } } 
        ],
        output: { schema: AnalysisOutputSchema },
      });

      if (!output) throw new Error("AI analysis failed to produce structured output.");
      
      const result = output;

      const combinedContent = `
Summary: ${result.summary}\n
Timeline:
${result.timeline.map((t: any) => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n
Visual Cues: ${result.visualCues.join(', ')}\n
Keywords: ${result.keywords.join(', ')}
      `.trim();

      // 5. Update Firestore
      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ [${episodeId}] Analysis Success!`);

    } catch (error: any) {
      console.error(`❌ [${episodeId}] Error:`, error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error)
      });
    } finally {
      // 6. Cleanup
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { /* 무시 */ }
      }
      
      if (uploadedFile?.name) {
        try { 
            await fileManager.deleteFile(uploadedFile.name); 
        } catch (e) { 
            console.warn("Remote cleanup failed", e); 
        }
      }
    }
});

// ==========================================
// [Trigger] 삭제 시 청소
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data) return;
    const { episodeId } = event.params;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    await Promise.all(paths.filter(p => p).map(p => bucket.file(p).delete().catch(() => {})));
    console.log(`✅ Cleanup finished for: ${episodeId}`);
});
