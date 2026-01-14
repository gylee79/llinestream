
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getPublicUrl } from '../../lib/utils'; // Assuming utils is accessible
import * as path from "path";

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

    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(filePath);
      
      // Make the file public to get a URL, or sign it
      // For simplicity, we'll use a public URL. Ensure your Storage Rules allow this.
      await file.makePublic();
      const publicUrl = file.publicUrl();

      console.log(`🎥 Calling ai.generate with public URL: ${publicUrl}`);
      const mimeType = getMimeType(filePath);

      const { output } = await ai.generate({
        model: 'gemini-pro-vision', // Use gemini-pro-vision as it's stable
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema. Ensure the output is a valid JSON object matching the schema." },
          { media: { url: publicUrl, contentType: mimeType } }
        ],
        output: {
          format: "json", // Request JSON output
        },
      });

      if (!output) throw new Error("AI analysis failed to produce output.");
      
      // Since we can't enforce schema in older versions, we parse it manually
      const result = AnalysisOutputSchema.parse(output);

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

    