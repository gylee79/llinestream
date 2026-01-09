
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit } from "genkit";
import { z } from "zod";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { DocumentSnapshot } from "firebase-admin/firestore";

// 0. Firebase Admin 초기화
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 2. Genkit 초기화
const ai = genkit({
  plugins: [googleAI()],
});

// 3. 정밀 분석 스키마 정의
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

// ==========================================
// 기능 1: 비디오 업로드 시 AI 분석 (File API 사용 버전)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();

    if (!afterData) return;

    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }

    if (afterData.aiProcessingStatus !== "processing" || beforeData?.aiProcessingStatus === "processing") {
      return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
      console.error("No filePath found");
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
      return;
    }

    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);

    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      const bucket = getStorage().bucket();

      console.log(`📥 Downloading video from Storage...`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      const mimeType = getMimeType(filePath);

      console.log(`📡 Uploading to Gemini File API... (${mimeType})`);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });

      const file = uploadResult.file;
      uploadedFileId = file.name;
      console.log(`✅ Uploaded to Gemini: ${file.uri}`);

      let state = file.state;
      console.log(`⏳ Waiting for video processing... Current state: ${state}`);
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(file.name);
        state = freshFile.state;
        console.log(`... processing state: ${state}`);
      }

      if (state === FileState.FAILED) {
        throw new Error("Video processing failed on Gemini side.");
      }

      console.log(`🎥 Analyzing...`);
      const llmResponse = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: {
          parts: [
            { text: "Analyze this video file comprehensively based on the provided JSON schema." },
            { fileData: { fileUri: file.uri, mimeType: mimeType } }
          ]
        },
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

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: new Date()
      });
      console.log("✅ Analysis Finished & Data Saved!");

    } catch (error) {
      console.error("❌ Error:", error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: String(error)
      });
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log("🧹 Local temp file cleaned up.");
      }
      if (uploadedFileId) {
        try {
          await fileManager.deleteFile(uploadedFileId);
          console.log("🧹 Gemini File cleaned up.");
        } catch (e) {
          console.log("⚠️ Failed to cleanup Gemini file (might be already deleted).");
        }
      }
    }
  }
);

// ==========================================
// 기능 2: 문서 삭제 시 파일 자동 청소
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data) return;

    const bucket = getStorage().bucket();
    const cleanupPromises: Promise<any>[] = [];

    // 파일 삭제 목록 추가
    if (data.filePath) {
      console.log(`🗑️ Deleting video: ${data.filePath}`);
      cleanupPromises.push(bucket.file(data.filePath).delete().catch(e => console.log(`⚠️ Skip: ${e.message}`)));
    }
    if (data.defaultThumbnailPath) {
      cleanupPromises.push(bucket.file(data.defaultThumbnailPath).delete().catch(e => console.log(`⚠️ Skip: ${e.message}`)));
    }
    if (data.customThumbnailPath) {
      cleanupPromises.push(bucket.file(data.customThumbnailPath).delete().catch(e => console.log(`⚠️ Skip: ${e.message}`)));
    }
    if (data.vttPath) {
      cleanupPromises.push(bucket.file(data.vttPath).delete().catch(e => console.log(`⚠️ Skip: ${e.message}`)));
    }

    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup finished: ${event.params.episodeId}`);
  }
);

    