
'use server';

import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { z } from "zod";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager } from "@google/generative-ai/server";

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

// 2. 전역 옵션 설정 (v2 방식) - 타임아웃 540초로 수정
setGlobalOptions({
  region: "asia-northeast3",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
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

// 4. MIME Type 도우미 함수
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".avi": return "video/x-msvideo";
    case ".wmv": return "video/x-ms-wmv";
    case ".webm": "video/webm";
    case ".mkv": "video/x-matroska";
    default: return "video/mp4";
  }
}

// ==========================================
// [Trigger] 파일 처리 및 AI 분석 실행 (v2 API)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
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
    let uploadedFile;

    try {
      // 1. Download file from Storage to a temporary directory
      console.log(`[${episodeId}] Downloading from Storage: ${filePath}`);
      const bucket = admin.storage().bucket();
      await bucket.file(filePath).download({ destination: tempFilePath });
      console.log(`[${episodeId}] Download complete. File at: ${tempFilePath}`);

      // 2. Upload file to Google AI File Manager
      console.log(`[${episodeId}] Uploading to Google AI File Manager...`);
      uploadedFile = await fileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      console.log(`[${episodeId}] Upload to AI Manager complete. URI: ${uploadedFile.uri}`);

      // 3. Call Gemini with the file URI (schema is enforced)
      console.log(`[${episodeId}] Calling Gemini 2.5 Flash for analysis...`);
      const { output } = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
          { media: { uri: uploadedFile.uri } }
        ],
        output: { schema: AnalysisOutputSchema },
      });

      if (!output) throw new Error("AI analysis failed to produce structured output.");
      
      const result = output;

      const combinedContent = `
Summary: ${result.summary}\n
Timeline:
${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n
Visual Cues: ${result.visualCues.join(', ')}\n
Keywords: ${result.keywords.join(', ')}
      `.trim();

      // 4. Update Firestore with the results
      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ [${episodeId}] Analysis Success! Firestore updated.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${episodeId}] Error during AI processing:`, error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: errorMessage
      });
    } finally {
      // 5. Clean up local and remote AI files
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[${episodeId}] Cleaned up temporary local file.`);
      }
      if (uploadedFile) {
        await fileManager.deleteFile(uploadedFile.name);
        console.log(`[${episodeId}] Cleaned up remote file from AI Manager.`);
      }
    }
});


// ==========================================
// [Trigger] 문서 삭제 시 파일 자동 청소 (v2 API)
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;
    
    const data = snap.data();
    if (!data) return;

    const { episodeId } = event.params;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    
    const deletePromises = paths
        .filter(p => p) // 경로가 있는 항목만 필터링
        .map(p => bucket.file(p).delete().catch(err => console.warn(`Failed to delete ${p}:`, err.message)));
    
    await Promise.all(deletePromises);
    console.log(`✅ Cleanup finished for deleted episode: ${episodeId}`);
});
