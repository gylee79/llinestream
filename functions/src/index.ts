/**
 * @fileoverview Video Analysis with Gemini 2.5 Pro
 * Model: gemini-2.5-pro (User Requested)
 */
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// 0. Firebase Admin 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

// 1. 전역 옵션 설정
setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
});

interface EpisodeData {
  filePath: string;
  aiProcessingStatus?: string;
  defaultThumbnailPath?: string;
  customThumbnailPath?: string;
  vttPath?: string;
  [key: string]: any;
}

// 2. MIME Type 도우미
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

// 3. 지연 초기화
let genAI: GoogleGenerativeAI | null = null;
let fileManager: any = null;

function initializeTools() {
  if (genAI && fileManager) return { genAI, fileManager };
  
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  genAI = new GoogleGenerativeAI(apiKey);
  fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager };
}

// ==========================================
// [Trigger] 메인 분석 함수
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
  }, 
  async (event) => {
    const change = event.data;
    if (!change) return;

    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted.`);
      return;
    }
    
    const afterData = change.after.data() as EpisodeData;
    if (!afterData) return;
    const { episodeId } = event.params;

    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${episodeId}]. Starting...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }
    if (afterData.aiProcessingStatus !== "processing") return;

    const filePath = afterData.filePath;
    if (!filePath) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath" });
      return;
    }

    // [요청하신 모델명 로그]
    console.log(`🚀 [${episodeId}] Processing started (Target: gemini-2.5-pro).`);
    
    const { genAI, fileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;
    const bucket = admin.storage().bucket();

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI processing failed.");

      console.log(`[${episodeId}] Calling Gemini 2.5 Pro...`);
      
      // [요청하신 모델명 적용] gemini-2.5-pro
      const model = genAI!.getGenerativeModel({ 
        model: "gemini-2.5-pro", 
        generationConfig: {
          responseMimeType: "application/json",
          // JSON 에러 방지용 스키마 (모델명은 2.5지만 출력은 안전하게)
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              transcript: { type: SchemaType.STRING, description: "영상의 전체 내용을 한국어로 번역한 대본" },
              summary: { type: SchemaType.STRING, description: "영상 내용에 대한 상세한 한국어 요약문" },
              timeline: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    startTime: { type: SchemaType.STRING },
                    endTime: { type: SchemaType.STRING },
                    subtitle: { type: SchemaType.STRING, description: "한국어로 번역된 자막" }
                  },
                  required: ["startTime", "endTime", "subtitle"]
                }
              },
              visualCues: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            },
            required: ["transcript", "summary", "timeline", "visualCues", "keywords"]
          }
        }
      }); 

      const prompt = `
      Analyze this video deeply. 
      Even if the video is in English, you MUST OUTPUT EVERYTHING IN KOREAN.
      Translate the context naturally.
      `;
      
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
        { text: prompt }
      ]);

      const output = JSON.parse(result.response.text());

      // VTT 자막 생성
      let vttUrl = null;
      let vttPath = null;
      if (output.timeline && Array.isArray(output.timeline)) {
        const vttContent = `WEBVTT\n\n${output.timeline
          .map((item: any) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
          .join('\n\n')}`;
        
        const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
        fs.writeFileSync(vttTempPath, vttContent);
        
        vttPath = `episodes/${episodeId}/subtitles/${episodeId}.vtt`;
        
        await bucket.upload(vttTempPath, {
          destination: vttPath,
          metadata: { contentType: 'text/vtt' },
        });

        vttUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(vttPath)}?alt=media`;
        if (fs.existsSync(vttTempPath)) fs.unlinkSync(vttTempPath);
        console.log(`[${episodeId}] VTT subtitle file created.`);
      }

      const combinedContent = `
요약: ${output.summary}\n
키워드: ${output.keywords?.join(', ') || ''}
      `.trim();

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: output.transcript || "",
        aiGeneratedContent: combinedContent,
        vttUrl: vttUrl,
        vttPath: vttPath,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ [${episodeId}] Success!`);

    } catch (error: any) {
      console.error(`❌ [${episodeId}] Error:`, error);
      
      // 429 (Too Many Requests) 에러인 경우, 함수를 재실행하도록 의도적으로 에러를 다시 던집니다.
      // Cloud Functions는 실패한 함수를 자동으로 재시도합니다.
      if (error.message?.includes("429")) {
         console.log(`[${episodeId}] Quota exceeded. Re-throwing error to trigger automatic retry.`);
         throw new Error(`Quota exceeded for ${episodeId}, triggering automated retry.`);
      }
      
      // 429가 아닌 다른 에러의 경우, 상태를 'failed'로 기록하고 함수를 정상 종료합니다.
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error)
      });

    } finally {
      if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch (e) {} }
      if (uploadedFile) { try { await fileManager.deleteFile(uploadedFile.name); } catch (e) {} }
    }
  }
);

export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as EpisodeData;
    if (!data) return;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    await Promise.all(paths.filter(Boolean).map(p => bucket.file(p!).delete().catch(() => {})));
});
