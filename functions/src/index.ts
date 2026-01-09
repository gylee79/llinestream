import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import * as path from "path";

// 0. Firebase Admin 초기화 (한 번만 실행)
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 2. Genkit 초기화 (별도 파일 없이 여기서 바로 설정)
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"), 
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

// [Helper] 파일 확장자에 따라 MIME Type을 찾아주는 도구 (AI 분석 실패 해결!)
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
    default: return "video/mp4"; // 모르면 mp4로 간주
  }
}

// ==========================================
// 기능 1: 비디오 업로드 시 AI 분석 (자동 시작 + 최적화)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 7200, // 9분 타임아웃
    memory: "2GiB",
  },
  async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) return;

    const data = snapshot.data();
    if (!data) return; // 데이터가 없으면 종료

    const currentStatus = data.aiProcessingStatus;

    // [핵심 1] 'pending'이면 자동으로 'processing'으로 바꿔서 스스로를 다시 호출함
    if (currentStatus === "pending") {
        console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
        await snapshot.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }

    // [핵심 2] 'processing' 상태가 아니면 무시 (중복 방지)
    if (currentStatus !== "processing") {
        return;
    }

    const filePath = data.filePath;
    if (!filePath) {
        console.error("No filePath found");
        await snapshot.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
        return;
    }

    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);

    try {
      const bucketName = getStorage().bucket().name;
      const gsUrl = `gs://${bucketName}/${filePath}`;
      
      // [핵심 3] 파일 타입 자동 감지 (에러 해결의 열쇠)
      const mimeType = getMimeType(filePath);
      
      console.log(`🎥 Analyzing Video via URL: ${gsUrl} (Type: ${mimeType})`);

      // [핵심 4] 다운로드 없이 URL만 전달 (가성비 최고)
      const llmResponse = await ai.generate({
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided schema." },
          { media: { url: gsUrl, contentType: mimeType } } 
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
    const cleanupPromises = [];

    if (data.filePath) {
      console.log(`🗑️ Deleting video file: ${data.filePath}`);
      cleanupPromises.push(
        bucket.file(data.filePath).delete().catch(err => {
           console.log(`⚠️ Video delete skipped: ${err.message}`);
        })
      );
    }

    if (data.thumbnailPath) {
      console.log(`🗑️ Deleting thumbnail file: ${data.thumbnailPath}`);
      cleanupPromises.push(
        bucket.file(data.thumbnailPath).delete().catch(err => {
           console.log(`⚠️ Thumbnail delete skipped: ${err.message}`);
        })
      );
    }

    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup finished for episode: ${event.params.episodeId}`);
  }
);