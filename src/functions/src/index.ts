
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import * as path from "path";
import { DocumentSnapshot } from "firebase-admin/firestore";

// 0. Firebase Admin 초기화 (한 번만 실행)
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
const apiKey = defineSecret("GEMINI_API_KEY");

// 2. Genkit 초기화 (별도 파일 없이 여기서 바로 설정)
const ai = genkit({
  plugins: [googleAI({ apiKey: apiKey as string })], // apiKey를 직접 전달
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
    timeoutSeconds: 540, // 9분 타임아웃
    memory: "1GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) {
      console.log(`[${event.params.episodeId}] Event data is undefined, skipping.`);
      return;
    }
    
    const beforeData = change.before.data();
    const afterData = change.after.data();
    
    if (!afterData) {
      console.log(`[${event.params.episodeId}] Document was deleted, skipping analysis.`);
      return;
    }

    // [핵심 1] 자동 실행 트리거: 'pending' 상태를 감지하고 'processing'으로 변경하여 스스로를 다시 호출함
    if (afterData.aiProcessingStatus === "pending") {
        console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
        // update는 함수를 다시 트리거하므로, 여기서 바로 return하여 중복 실행을 막습니다.
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }

    // [핵심 2] 실행 조건: 'processing' 상태가 아니면 무시 (중복 실행 및 불필요한 실행 방지)
    if (afterData.aiProcessingStatus !== "processing") {
        return;
    }
    
    // 'processing' 상태로의 변경 이벤트 자체는 무시 (무한 루프 방지)
    if (beforeData?.aiProcessingStatus === 'pending' && afterData.aiProcessingStatus === 'processing') {
      console.log(`[${event.params.episodeId}] Status changed from pending to processing. Main logic will now run.`);
    } else if (beforeData?.aiProcessingStatus === afterData.aiProcessingStatus) {
      // 그 외 필드 변경은 무시
      return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
        console.error("No filePath found for analysis.");
        await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
        return;
    }

    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);

    try {
      const bucketName = getStorage().bucket().name;
      const gsUrl = `gs://${bucketName}/${filePath}`;
      
      // [핵심 3] MIME Type 명시: 파일 타입 자동 감지 (에러 해결의 열쇠)
      const mimeType = getMimeType(filePath);
      
      console.log(`🎥 Analyzing Video via URL: ${gsUrl} (Type: ${mimeType})`);

      // [핵심 4] 다운로드 금지: 다운로드 없이 URL만 전달 (가성비 최고)
      const llmResponse = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [
          { text: "Analyze this video file comprehensively based on the provided JSON schema." },
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

    // 비디오 파일 삭제
    if (data.filePath) {
      console.log(`🗑️ Deleting video file: ${data.filePath}`);
      cleanupPromises.push(
        bucket.file(data.filePath).delete().catch(err => {
           console.log(`⚠️ Video delete skipped: ${err.message}`);
        })
      );
    }
    
    // 대표 썸네일 삭제
    if (data.defaultThumbnailPath) {
      console.log(`🗑️ Deleting default thumbnail file: ${data.defaultThumbnailPath}`);
      cleanupPromises.push(
        bucket.file(data.defaultThumbnailPath).delete().catch(err => {
           console.log(`⚠️ Default thumbnail delete skipped: ${err.message}`);
        })
      );
    }

    // 커스텀 썸네일 삭제
    if (data.customThumbnailPath) {
      console.log(`🗑️ Deleting custom thumbnail file: ${data.customThumbnailPath}`);
      cleanupPromises.push(
        bucket.file(data.customThumbnailPath).delete().catch(err => {
           console.log(`⚠️ Custom thumbnail delete skipped: ${err.message}`);
        })
      );
    }
    
    // 자막 파일 삭제
    if (data.vttPath) {
      console.log(`🗑️ Deleting VTT file: ${data.vttPath}`);
      cleanupPromises.push(
        bucket.file(data.vttPath).delete().catch(err => {
           console.log(`⚠️ VTT delete skipped: ${err.message}`);
        })
      );
    }

    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup finished for episode: ${event.params.episodeId}`);
  }
);

// 더 이상 사용하지 않는 genkit.ts 파일은 삭제해도 좋습니다.
// 아래 코드는 삭제된 genkit.ts 파일의 내용을 포함하고 있어, 별도 파일이 필요 없습니다.
// import { genkit } from 'genkit';
// import { googleAI } from '@genkit-ai/google-genai';
// import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
// enableFirebaseTelemetry();
// export const ai = genkit({ ... });
