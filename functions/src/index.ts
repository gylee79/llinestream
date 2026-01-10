
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

// 0. Firebase Admin 초기화
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 2. Genkit 초기화 (최신 가이드에 따라 apiVersion 제거)
const ai = genkit({
  plugins: [googleAI()],
});

// 3. AI 분석 결과에 대한 Zod 스키마 정의
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


// ==========================================
// [Trigger] 파일 처리 및 AI 분석 실행
// ==========================================

// [Helper] MIME Type 도구
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

export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 3600, // 1시간
    memory: "2GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    if (!afterData) return;

    // 상태 관리: Pending -> Processing
    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }

    // 이미 처리 중이거나 완료된 경우 스킵
    if (afterData.aiProcessingStatus !== "processing") return;
    if (beforeData?.aiProcessingStatus === "processing") return;

    const filePath = afterData.filePath;
    if (!filePath) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
      return;
    }

    console.log("🚀 Starting Video Processing:", event.params.episodeId);

    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      // 1. Storage에서 다운로드
      console.log(`📥 Downloading...`);
      await getStorage().bucket().file(filePath).download({ destination: tempFilePath });

      // 2. Gemini File API 업로드
      const mimeType = getMimeType(filePath);
      console.log(`📡 Uploading to Gemini... (${mimeType})`);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });

      const file = uploadResult.file;
      uploadedFileId = file.name;

      // 3. 처리 대기 (Polling)
      let state = file.state;
      console.log(`⏳ Waiting for Gemini processing...`);
      while (state === FileState.PROCESSING) {
        await new Promise((r) => setTimeout(r, 5000));
        const freshFile = await fileManager.getFile(file.name);
        state = freshFile.state;
      }

      if (state === FileState.FAILED) throw new Error("Gemini File Processing Failed.");

      // 4. ★ AI 분석 직접 호출 (Zod 스키마 적용)
      console.log(`🎥 Calling ai.generate with correct file URI: ${file.uri}`);
      const { output } = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
          { media: { url: file.uri, contentType: file.mimeType } }
        ],
        output: { schema: AnalysisOutputSchema },
      });

      if (!output) throw new Error("AI analysis failed to produce output.");
      const result = output;

      // 5. 결과 저장
      const combinedContent = `
Summary: ${result.summary}\n
Timeline:
${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n
Visual Cues: ${result.visualCues.join(', ')}\n
Keywords: ${result.keywords.join(', ')}
      `.trim();

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: new Date()
      });
      console.log("✅ Analysis Success!");

    } catch (error) {
      console.error("❌ Error:", error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: String(error)
      });
    } finally {
      // 6. 청소 (Cleanup)
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (uploadedFileId) {
        try { await fileManager.deleteFile(uploadedFileId); } catch (e) { console.log("⚠️ Cleanup warning"); }
      }
    }
  }
);

// ==========================================
// 기능 2: 문서 삭제 시 파일 자동 청소 (기존 유지)
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const bucket = getStorage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    
    await Promise.all(
      paths.filter(p => p).map(p => bucket.file(p).delete().catch(() => {}))
    );
    console.log(`✅ Cleanup finished: ${event.params.episodeId}`);
  }
);
