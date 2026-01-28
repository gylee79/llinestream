
/**
 * @fileoverview Video Analysis with Gemini using Firebase Cloud Functions v2.
 * Model: gemini-2.5-flash
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// 0. Firebase Admin & Global Options 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB", // Gen 2 uses GiB
});


// 1. MIME Type 도우미
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

// 2. 지연 초기화 (Lazy Initialization)
let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;

function initializeTools() {
  if (genAI && fileManager) return { genAI, fileManager };
  
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  genAI = new GoogleGenerativeAI(apiKey);
  fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager };
}

// ==========================================
// [Trigger] 메인 분석 함수 (v2 onDocumentWritten)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change) return;

    // 문서가 삭제되었거나, 데이터가 없는 경우는 무시
    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted, skipping.`);
      return;
    }
    
    const afterData = change.after.data() as EpisodeData;
    const beforeData = change.before.exists ? change.before.data() as EpisodeData : null;

    // === 트리거 로직: 'pending' 상태일 때만 실행 ===
    if (afterData.aiProcessingStatus !== 'pending' || (beforeData && beforeData.aiProcessingStatus === 'pending')) {
      return;
    }

    const { episodeId } = event.params;
    const docRef = change.after.ref;
    const db = admin.firestore();

    console.log(`✨ [${episodeId}] New analysis job detected. Starting...`);

    // 즉시 'processing'으로 상태 변경하여 중복 실행 방지
    await docRef.update({ aiProcessingStatus: "processing" });
    
    const filePath = afterData.filePath;
    if (!filePath) {
      await docRef.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath" });
      return;
    }

    const modelName = "gemini-2.5-flash";
    console.log(`🚀 [${episodeId}] Processing started (Target: ${modelName}).`);
    
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;
    const bucket = admin.storage().bucket();

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await localFileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI processing failed.");

      console.log(`[${episodeId}] Calling Gemini model...`);
      
      const model = localGenAI.getGenerativeModel({ 
        model: modelName, 
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              transcript: { type: SchemaType.STRING, description: "영상의 전체 내용을 한국어로 번역한 대본입니다. 영상이 영어라도 반드시 한국어로 번역해주세요." },
              summary: { type: SchemaType.STRING, description: "영상 전체 내용에 대한 상세하고 구조화된 한국어 요약문입니다." },
              timeline: {
                type: SchemaType.ARRAY,
                description: "시간대별 주요 이벤트 및 화면에 대한 상세 설명입니다.",
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    startTime: { type: SchemaType.STRING, description: "이벤트 시작 시간. 반드시 HH:MM:SS.mmm 형식이어야 합니다." },
                    endTime: { type: SchemaType.STRING, description: "이벤트 종료 시간. 반드시 HH:MM:SS.mmm 형식이어야 합니다." },
                    subtitle: { type: SchemaType.STRING, description: "해당 시간대의 핵심 대사 또는 자막입니다. (한국어)" },
                    description: { type: SchemaType.STRING, description: "해당 시간대에 화면에 나타나는 시각적 요소(인물, 사물, 텍스트, 슬라이드 내용 등)와 상황에 대한 상세한 설명입니다. (한국어)" }
                  },
                  required: ["startTime", "endTime", "subtitle", "description"]
                }
              },
              keywords: { type: SchemaType.ARRAY, description: "영상 콘텐츠의 핵심 키워드 목록입니다. (한국어)", items: { type: SchemaType.STRING } }
            },
            required: ["transcript", "summary", "timeline", "keywords"]
          }
        }
      }); 

      const prompt = `Analyze this video deeply. Even if the video is in English, you MUST OUTPUT EVERYTHING IN KOREAN. Translate the context naturally.`;
      
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
        { text: prompt }
      ]);

      const output = JSON.parse(result.response.text());

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

        if (fs.existsSync(vttTempPath)) fs.unlinkSync(vttTempPath);
        console.log(`[${episodeId}] VTT subtitle file created.`);
      }

      const analysisJsonString = JSON.stringify(output);

      const courseDoc = await db.collection('courses').doc(afterData.courseId).get();
      if (!courseDoc.exists) throw new Error(`Course not found for episode ${episodeId}`);
      const classificationDoc = await db.collection('classifications').doc(courseDoc.data()!.classificationId).get();
      if (!classificationDoc.exists) throw new Error(`Classification not found for course ${courseDoc.id}`);
      const fieldId = classificationDoc.data()!.fieldId;
      
      const aiChunkData = {
          episodeId,
          courseId: afterData.courseId,
          classificationId: courseDoc.data()!.classificationId,
          fieldId,
          content: analysisJsonString, // Store full analysis as JSON string
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      
      batch.update(docRef, {
        aiProcessingStatus: "completed",
        aiModel: modelName,
        transcript: output.transcript || "",
        aiGeneratedContent: analysisJsonString, // Store full analysis as JSON string
        vttPath: vttPath,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const aiChunkRef = db.collection('episode_ai_chunks').doc(episodeId);
      batch.set(aiChunkRef, aiChunkData);

      await batch.commit();

      console.log(`✅ [${episodeId}] Success!`);

    } catch (error: any) {
      const detailedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      console.error(`❌ [${episodeId}] Analysis failed. Detailed error:`, detailedError);
      
      await docRef.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error)
      });

    } finally {
      if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch (e) {} }
      if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
    }
});

// ==========================================
// [Trigger] 파일 삭제 함수 (v2 onDocumentDeleted)
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const { episodeId } = event.params;
    const data = snap.data() as EpisodeData;
    if (!data) return;

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    await Promise.all(paths.filter(Boolean).map(p => bucket.file(p!).delete().catch(() => {})));
    
    const aiChunkRef = db.collection('episode_ai_chunks').doc(episodeId);
    await aiChunkRef.delete().catch(() => {});

    console.log(`[DELETE SUCCESS] Cleaned up files and AI chunk for deleted episode ${episodeId}`);
});

interface EpisodeData {
  filePath: string;
  courseId: string;
  aiProcessingStatus?: string;
  defaultThumbnailPath?: string;
  customThumbnailPath?: string;
  vttPath?: string;
  [key: string]: any;
}
