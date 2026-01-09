
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

// 2. Genkit 초기화 (Cloud Function 실행 컨텍스트 내에서 직접)
const ai = genkit({
  plugins: [googleAI({ apiVersion: "v1beta" })],
});

// 3. AI 분석 로직을 담당할 Flow 정의
const videoAnalysisFlow = ai.defineFlow(
  {
    name: 'videoAnalysisFlow',
    inputSchema: z.object({
      fileUri: z.string().describe("The URI of the uploaded file in Gemini (File API)"),
      mimeType: z.string().describe("The MIME type of the video file"),
    }),
    outputSchema: z.object({
      transcript: z.string().describe('The full and accurate audio transcript of the video.'),
      summary: z.string().describe('A concise summary of the entire video content.'),
      timeline: z.array(z.object({
        timestamp: z.string().describe('The timestamp of the event in HH:MM:SS format.'),
        event: z.string().describe('A description of what is happening at this timestamp.'),
        visualDetail: z.string().describe('Notable visual details, like objects or character appearances.'),
      })).describe('An array of time-stamped logs detailing events throughout the video.'),
      visualCues: z.array(z.string()).describe('A list of important on-screen text (OCR) or significant visual objects.'),
      keywords: z.array(z.string()).describe('An array of relevant keywords for searching and tagging.'),
    }),
  },
  async (input) => {
    const { output } = await ai.generate({
      model: 'gemini-1.5-flash',
      prompt: [
        { text: "Analyze this video file comprehensively based on the provided JSON schema." },
        { media: { url: input.fileUri, contentType: input.mimeType } }
      ],
      output: { format: "json", schema: z.any() }, // Output 스키마를 Flow에서 관리하므로 여기서는 any로 설정
    });
    if (!output) throw new Error('AI 분석 결과를 생성하지 못했습니다.');
    return output;
  }
);


// [Helper] 파일 확장자에 따라 MIME Type을 찾아주는 도구
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".avi": return "video/x-msvideo";
    case ".wmv": return "video/x-ms-wmv";
    case ".flv": return "video/x-flv";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    case ".3gp": return "video/3gpp";
    case ".mpg":
    case ".mpeg": return "video/mpeg";
    default: return "video/mp4";
  }
}

// =============================================================
// 기능 1: 비디오 업로드 시 AI 분석을 트리거하는 Cloud Function
// =============================================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 3600,
    memory: "2GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();

    if (!afterData) return;

    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ [${event.params.episodeId}] New upload detected. Auto-starting analysis...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }

    if (afterData.aiProcessingStatus !== "processing" || beforeData?.aiProcessingStatus === "processing") {
      return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
      return;
    }

    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      // 1. 파일 준비 (Storage 다운로드 -> Gemini 업로드)
      const bucket = getStorage().bucket();
      await bucket.file(filePath).download({ destination: tempFilePath });
      const mimeType = getMimeType(filePath);

      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });

      const file = uploadResult.file;
      uploadedFileId = file.name;
      
      let state = file.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(file.name);
        state = freshFile.state;
      }
      if (state === FileState.FAILED) throw new Error("Video processing failed on Gemini side.");

      // 2. 준비된 파일 정보로 Genkit Flow 실행
      const result = await videoAnalysisFlow({ fileUri: file.uri, mimeType });

      // 3. 결과 포맷팅 및 저장
      const combinedContent = `Summary: ${result.summary}\n\nTimeline:\n${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n\nVisual Cues: ${result.visualCues.join(', ')}\n\nKeywords: ${result.keywords.join(', ')}`.trim();

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: new Date()
      });
      console.log(`✅ [${event.params.episodeId}] Analysis Finished & Data Saved!`);

    } catch (error) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: String(error) });
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (uploadedFileId) {
        try { await fileManager.deleteFile(uploadedFileId); } catch (e) { console.warn("Cleanup warning: Failed to delete Gemini file."); }
      }
    }
  }
);

// ========================================================
// 기능 2: 문서 삭제 시 Storage 파일 자동 청소 (기존과 동일)
// ========================================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const bucket = getStorage().bucket();
    const cleanupPromises: Promise<any>[] = [];

    if (data.filePath) cleanupPromises.push(bucket.file(data.filePath).delete().catch(() => {}));
    if (data.defaultThumbnailPath) cleanupPromises.push(bucket.file(data.defaultThumbnailPath).delete().catch(() => {}));
    if (data.customThumbnailPath) cleanupPromises.push(bucket.file(data.customThumbnailPath).delete().catch(() => {}));
    if (data.vttPath) cleanupPromises.push(bucket.file(data.vttPath).delete().catch(() => {}));

    await Promise.all(cleanupPromises);
    console.log(`✅ [${event.params.episodeId}] Cleanup finished.`);
  }
);
