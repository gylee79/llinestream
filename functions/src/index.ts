
'use server';

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import * as path from "path";

// 0. Firebase Admin 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

// 1. Genkit 초기화 (API Key는 Secret Manager를 통해 주입됨)
const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
});

// 2. AI 분석 결과에 대한 Zod 스키마 정의
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

// 3. MIME Type 도우미 함수
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
// [Trigger] 파일 처리 및 AI 분석 실행 (v1 API 구문)
// ==========================================
exports.analyzeVideoOnWrite = functions
  .runWith({
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: ["GOOGLE_GENAI_API_KEY"],
  })
  .region("asia-northeast3")
  .firestore.document("episodes/{episodeId}")
  .onWrite(async (change: functions.Change<functions.firestore.DocumentSnapshot>, context: functions.EventContext) => {
    
    // 문서가 삭제되었거나 데이터가 없는 경우 종료
    if (!change.after.exists) {
      functions.logger.log(`[${context.params.episodeId}] Document deleted. Skipping.`);
      return null;
    }
    const afterData = change.after.data();
    if (!afterData) return null;

    const beforeData = change.before.exists ? change.before.data() : null;
    const { episodeId } = context.params;

    // 상태 관리: 'pending' -> 'processing'
    if (afterData.aiProcessingStatus === "pending") {
      functions.logger.log(`✨ New upload detected [${episodeId}]. Setting status to 'processing'.`);
      return change.after.ref.update({ aiProcessingStatus: "processing" });
    }

    // 이미 처리 중이거나 완료된 경우, 또는 상태가 'processing'으로 변경된 직후의 호출인 경우 스킵
    if (afterData.aiProcessingStatus !== "processing") return null;
    if (beforeData?.aiProcessingStatus === "processing") return null;

    const filePath = afterData.filePath;
    if (!filePath) {
      functions.logger.error(`[${episodeId}] No filePath found.`);
      return change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
    }

    functions.logger.log(`🚀 Starting Video Processing: ${episodeId}`);

    try {
      let videoUrl = afterData.videoUrl;

      // videoUrl이 없는 경우, 공개 URL을 생성합니다.
      if (!videoUrl) {
          functions.logger.info(`[${episodeId}] No videoUrl found for ${filePath}. Generating public URL.`);
          const bucket = admin.storage().bucket();
          const file = bucket.file(filePath);
          const [exists] = await file.exists();
          if (!exists) throw new Error("File does not exist in Firebase Storage.");
          
          // 파일을 공개로 설정합니다. (Storage 규칙에서 공개 접근이 허용되어야 함)
          await file.makePublic();
          videoUrl = file.publicUrl();
          functions.logger.info(`[${episodeId}] Generated public URL: ${videoUrl}`);
      }

      const mimeType = getMimeType(filePath);

      functions.logger.log(`🎥 Calling ai.generate with URL: ${videoUrl}`);
      
      const { output } = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
          { media: { url: videoUrl, contentType: mimeType } }
        ],
        output: { schema: AnalysisOutputSchema },
      });

      if (!output) throw new Error("AI analysis failed to produce output.");
      
      const result = output;

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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      functions.logger.log(`✅ [${episodeId}] Analysis Success!`);
      return null;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      functions.logger.error(`❌ [${episodeId}] Error during AI processing:`, error);
      return change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: errorMessage
      });
    }
  });


// ==========================================
// [Trigger] 문서 삭제 시 파일 자동 청소 (v1 API 구문)
// ==========================================
exports.deleteFilesOnEpisodeDelete = functions.region("asia-northeast3")
  .firestore.document("episodes/{episodeId}")
  .onDelete(async (snap: functions.firestore.DocumentSnapshot, context: functions.EventContext) => {
    const data = snap.data();
    if (!data) return null;

    const { episodeId } = context.params;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    
    const deletePromises = paths
        .filter(p => p) // 경로가 있는 항목만 필터링
        .map(p => bucket.file(p).delete().catch(err => functions.logger.warn(`Failed to delete ${p}:`, err.message)));
    
    await Promise.all(deletePromises);
    functions.logger.log(`✅ Cleanup finished for deleted episode: ${episodeId}`);
    return null;
  });
