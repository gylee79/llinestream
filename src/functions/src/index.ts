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

// 2. Genkit 초기화 (플러그인 및 모델 설정)
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-1.5-flash", { // 2.5가 안되면 1.5로 설정
    temperature: 0.7,
  }),
});

// ==========================================
// [Genkit Flow] AI 로직 정의 부분 (가이드 스타일)
// ==========================================

// 3-1. Input Schema (Flow가 받을 데이터)
const VideoAnalysisInputSchema = z.object({
  fileUri: z.string().describe("The URI of the uploaded file in Gemini (File API)"),
  mimeType: z.string().describe("The MIME type of the video file"),
});

// 3-2. Output Schema (Flow가 내뱉을 데이터 - 기존과 동일)
const VideoAnalysisOutputSchema = z.object({
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

// 3-3. Flow 정의 (recipeGeneratorFlow와 같은 방식)
export const videoAnalysisFlow = ai.defineFlow(
  {
    name: 'videoAnalysisFlow',
    inputSchema: VideoAnalysisInputSchema,
    outputSchema: VideoAnalysisOutputSchema,
  },
  async (input) => {
    // 프롬프트 생성
    const promptText = "Analyze this video file comprehensively based on the provided JSON schema.";
    
    // AI 생성 요청
    const { output } = await ai.generate({
      prompt: [
        { text: promptText },
        { media: { url: input.fileUri, contentType: input.mimeType } }
      ],
      output: { schema: VideoAnalysisOutputSchema },
    });

    if (!output) throw new Error('Failed to generate analysis result');

    return output;
  }
);


// ==========================================
// [Helper] 유틸리티 함수
// ==========================================
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
// 기능 1: 비디오 업로드 시 AI 분석 (Trigger)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 3600, // 긴 영상 처리를 위해 1시간으로 늘림
    memory: "2GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    
    if (!afterData) return;

    // 상태 체크 및 자동 실행 로직
    if (afterData.aiProcessingStatus === "pending") {
        console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }
    if (afterData.aiProcessingStatus !== "processing") return;
    if (beforeData?.aiProcessingStatus === afterData.aiProcessingStatus) return;

    const filePath = afterData.filePath;
    if (!filePath) {
        console.error("No filePath found");
        await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
        return;
    }

    console.log("🚀 Video Analysis Trigger Started:", event.params.episodeId);

    // GoogleAIFileManager는 Flow 밖에서 파일 준비용으로 사용 (대용량 처리를 위해 유지)
    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      const bucket = getStorage().bucket();
      
      console.log(`📥 Downloading video...`);
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const mimeType = getMimeType(filePath);
      
      console.log(`📡 Uploading to Gemini File API... (${mimeType})`);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });
      
      const file = uploadResult.file;
      uploadedFileId = file.name;
      console.log(`✅ Uploaded: ${file.uri}`);

      // 파일 처리 대기
      let state = file.state;
      console.log(`⏳ Waiting for processing...`);
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(file.name);
        state = freshFile.state;
      }

      if (state === FileState.FAILED) {
        throw new Error("Video processing failed on Gemini side.");
      }

      // [핵심 변경] 여기서 우리가 정의한 Genkit Flow를 호출합니다!
      console.log(`🎥 Calling Genkit Flow...`);
      
      // Flow 실행 (마치 함수처럼 호출)
      const result = await videoAnalysisFlow({
        fileUri: file.uri,
        mimeType: mimeType
      });

      // 결과 처리 문자열 포맷팅
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
      // 청소(Cleanup) 로직
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (uploadedFileId) {
        try {
          await fileManager.deleteFile(uploadedFileId);
          console.log("🧹 Gemini File cleaned up.");
        } catch (e) {
          console.log("⚠️ Cleanup warning:", e);
        }
      }
    }
  }
);

// ==========================================
// 기능 2: 문서 삭제 시 파일 자동 청소 (기존 동일)
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

    if (data.filePath) cleanupPromises.push(bucket.file(data.filePath).delete().catch(() => {}));
    if (data.defaultThumbnailPath) cleanupPromises.push(bucket.file(data.defaultThumbnailPath).delete().catch(() => {}));
    if (data.customThumbnailPath) cleanupPromises.push(bucket.file(data.customThumbnailPath).delete().catch(() => {}));
    if (data.vttPath) cleanupPromises.push(bucket.file(data.vttPath).delete().catch(() => {}));

    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup finished: ${event.params.episodeId}`);
  }
);
