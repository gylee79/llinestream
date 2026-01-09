
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import * as path from "path";
import * as os from "os"; // [추가됨] 임시 파일 처리를 위해 필요
import * as fs from "fs"; // [추가됨] 파일 삭제를 위해 필요
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server"; // [추가됨] 파일 매니저
import { DocumentSnapshot } from "firebase-admin/firestore";

// 0. Firebase Admin 초기화
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
// (주의: Google Cloud Secret Manager에 "GOOGLE_GENAI_API_KEY"라는 이름으로 키가 있어야 합니다)
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
    memory: "2GiB", // [변경됨] 비디오 파일 처리를 위해 메모리를 2GB로 늘림
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    
    if (!afterData) return;

    // 1. 자동 실행 트리거 (Pending -> Processing)
    if (afterData.aiProcessingStatus === "pending") {
        console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }

    // 2. 실행 조건 체크
    if (afterData.aiProcessingStatus !== "processing") {
        return;
    }
    
    // 무한 루프 방지
    if (beforeData?.aiProcessingStatus === afterData.aiProcessingStatus) {
      return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
        console.error("No filePath found");
        await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
        return;
    }

    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);

    // [핵심 변경] 파일 매니저 초기화 (API Key 사용)
    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      const bucket = getStorage().bucket();
      
      // A. 스토리지에서 비디오를 임시 폴더로 다운로드
      console.log(`📥 Downloading video from Storage...`);
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const mimeType = getMimeType(filePath);
      
      // B. Gemini 파일 API로 업로드
      console.log(`Tc Uploading to Gemini File API... (${mimeType})`);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });
      
      const file = uploadResult.file;
      uploadedFileId = file.name;
      console.log(`✅ Uploaded to Gemini: ${file.uri}`);

      // C. 비디오 처리 대기 (Gemini가 비디오를 인식할 때까지 기다림)
      let state = file.state;
      console.log(`⏳ Waiting for video processing...`);
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5초마다 확인
        const freshFile = await fileManager.getFile(file.name);
        state = freshFile.state;
        console.log(`... processing state: ${state}`);
      }

      if (state === FileState.FAILED) {
        throw new Error("Video processing failed on Gemini side.");
      }

      // D. 분석 요청 (이제 gs:// 대신 file.uri 사용!)
      console.log(`🎥 Analyzing...`);
      const llmResponse = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
          { media: { url: file.uri, contentType: mimeType } } // [핵심] 여기가 gsUrl에서 file.uri로 바뀜
        ],
        output: {
          format: "json",
          schema: AnalysisOutputSchema,
        },
      });

      const result = llmResponse.output;
      if (!result) throw new Error("No output from AI");

      const combinedContent = `
Summary: ${result.summary}

Timeline:
${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}

Visual Cues: ${result.visualCues.join(', ')}

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
      // E. 뒷정리 (임시 파일 삭제)
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath); // 로컬 파일 삭제
      }
      if (uploadedFileId) {
        try {
          await fileManager.deleteFile(uploadedFileId); // Gemini 서버 파일 삭제
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
    // [타입 수정] Promise<any>[] 타입을 명시해서 빨간 줄 해결
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

    