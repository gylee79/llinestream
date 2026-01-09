
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

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
// 기능 1: 비디오 업로드 시 AI 분석 (Google AI File API 방식)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 540,
    memory: "2GiB", // 메모리 증가
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    
    if (!afterData) return;

    // 자동 실행 트리거
    if (afterData.aiProcessingStatus === "pending") {
        console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting analysis...`);
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return; 
    }

    // 실행 조건 체크 및 중복 실행 방지
    if (afterData.aiProcessingStatus !== "processing" || beforeData?.aiProcessingStatus === afterData.aiProcessingStatus) {
        return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
        console.error("No filePath found");
        await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
        return;
    }
    
    console.log("🚀 Gemini 2.5 Video Analysis Started:", event.params.episodeId);

    const bucket = getStorage().bucket();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    const fileManager = new GoogleAIFileManager(process.env.GOOGLE_GENAI_API_KEY!);
    let uploadedFile = null;

    try {
        // 1. Storage에서 임시 폴더로 다운로드
        console.log(`Downloading ${filePath} to ${tempFilePath}...`);
        await bucket.file(filePath).download({ destination: tempFilePath });
        console.log('Download complete.');
        
        // 2. Google AI 서버로 파일 업로드
        console.log('Uploading to Google AI File API...');
        uploadedFile = await fileManager.uploadFile(tempFilePath, {
            mimeType: getMimeType(filePath),
            displayName: event.params.episodeId,
        });
        console.log(`Upload successful. File URI: ${uploadedFile.file.uri}`);

        // 3. 파일 처리 상태 확인 (Polling)
        let fileState = uploadedFile.file.state;
        while(fileState === FileState.PROCESSING) {
            console.log('File is processing...');
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
            uploadedFile.file = await fileManager.getFile(uploadedFile.file.name);
            fileState = uploadedFile.file.state;
        }

        if (fileState !== FileState.ACTIVE) {
            throw new Error(`File processing failed. Final state: ${fileState}`);
        }
        console.log('File is active and ready for analysis.');

        // 4. Gemini로 분석 요청
        const llmResponse = await ai.generate({
            prompt: [
              { text: "Analyze this video file comprehensively based on the provided JSON schema." },
              { media: { url: uploadedFile.file.uri } } 
            ],
            output: {
              format: "json",
              schema: AnalysisOutputSchema,
            },
        });

        const result = llmResponse.output;
        if (!result) throw new Error("No output from AI");
        
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
        console.log("✅ Analysis Finished & Data Saved!");

    } catch (error) {
        console.error("❌ Error during video analysis:", error);
        await change.after.ref.update({ 
            aiProcessingStatus: "failed", 
            aiProcessingError: String(error) 
        });
    } finally {
        // 6. 리소스 정리 (Cleanup)
        console.log('Cleaning up resources...');
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('Local temp file deleted.');
            }
            if (uploadedFile?.file?.name) {
                await fileManager.deleteFile(uploadedFile.file.name);
                console.log('Google AI file deleted.');
            }
        } catch (cleanupError) {
            console.error('❌ Error during cleanup:', cleanupError);
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

    if (data.filePath) {
      console.log(`🗑️ Deleting video file: ${data.filePath}`);
      cleanupPromises.push(
        bucket.file(data.filePath).delete().catch(err => {
           console.log(`⚠️ Video delete skipped: ${err.message}`);
        })
      );
    }
    
    // 썸네일 경로 필드명 수정 및 추가
    if (data.defaultThumbnailPath) {
      console.log(`🗑️ Deleting default thumbnail: ${data.defaultThumbnailPath}`);
      cleanupPromises.push(bucket.file(data.defaultThumbnailPath).delete().catch(err => console.log(`⚠️ Skip: ${err.message}`)));
    }

    if (data.customThumbnailPath) {
      console.log(`🗑️ Deleting custom thumbnail: ${data.customThumbnailPath}`);
      cleanupPromises.push(bucket.file(data.customThumbnailPath).delete().catch(err => console.log(`⚠️ Skip: ${err.message}`)));
    }
    
    if (data.vttPath) {
      console.log(`🗑️ Deleting VTT file: ${data.vttPath}`);
      cleanupPromises.push(bucket.file(data.vttPath).delete().catch(err => console.log(`⚠️ Skip: ${err.message}`)));
    }

    await Promise.all(cleanupPromises);
    console.log(`✅ Cleanup finished for episode: ${event.params.episodeId}`);
  }
);

    