
/**
 * @fileoverview Video Analysis with Gemini & Transcoder API using Firebase Cloud Functions v2.
 * Gemini Model: gemini-2.5-flash
 * Transcoder API for HLS Packaging with AES-128 encryption.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { TranscoderServiceClient } from '@google-cloud/video-transcoder').v1;
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

// 0. Firebase Admin & Global Options 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 1200, // Increased timeout for polling
  memory: "2GiB",
});

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();


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
let transcoderClient: TranscoderServiceClient | null = null;

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  if (!transcoderClient) transcoderClient = new TranscoderServiceClient();
  
  return { genAI, fileManager, transcoderClient };
}


// 3. HLS Packaging with Transcoder API (AES-128)
async function createHlsPackagingJob(episodeId: string, inputUri: string, docRef: admin.firestore.DocumentReference): Promise<void> {
    const { transcoderClient: client } = initializeTools();
    const projectId = await client.getProjectId();
    const location = 'us-central1';

    const outputFolder = `episodes/${episodeId}/packaged/`;
    const outputUri = `gs://${bucket.name}/${outputFolder}`;

    // --- AES-128 Encryption Key Generation & Upload ---
    const aesKey = crypto.randomBytes(16);
    const keyFileName = 'enc.key';
    const keyStoragePath = `episodes/${episodeId}/keys/${keyFileName}`;
    const keyFile = bucket.file(keyStoragePath);
    
    console.log(`[${episodeId}] HLS Job: Uploading AES-128 key to ${keyStoragePath}`);
    await keyFile.save(aesKey);
    console.log(`[${episodeId}] HLS Job: AES-128 key uploaded.`);
    
    const keyStorageUri = `gs://${bucket.name}/${keyStoragePath}`;
    
    const signedUrlExpireTime = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days validity
    const [signedKeyUrl] = await keyFile.getSignedUrl({
        action: 'read',
        expires: signedUrlExpireTime
    });
    console.log(`[${episodeId}] HLS Job: Generated Signed URL for key.`);

    console.log(`[${episodeId}] HLS Job: Starting HLS packaging job for ${inputUri}`);
    await docRef.update({ packagingStatus: "processing" });

    const request = {
        parent: `projects/${projectId}/locations/${location}`,
        job: {
            inputUri,
            outputUri,
            config: {
                muxStreams: [
                    {
                        key: 'sd-hls',
                        container: 'ts',
                        elementaryStreams: ['sd-video-stream', 'audio-stream'],
                        segmentSettings: {
                            individualSegments: true,
                            segmentDuration: { seconds: 4 },
                        },
                        encryptionId: 'aes-128-encryption',
                    },
                ],
                elementaryStreams: [
                    {
                        key: 'sd-video-stream',
                        videoStream: {
                            h264: { heightPixels: 480, widthPixels: 854, bitrateBps: 1000000, frameRate: 30 },
                        },
                    },
                    {
                        key: 'audio-stream',
                        audioStream: { codec: 'aac', bitrateBps: 128000 },
                    },
                ],
                manifests: [
                    {
                        fileName: 'manifest.m3u8',
                        type: 'HLS',
                        muxStreams: ['sd-hls'],
                    },
                ],
                encryptions: [
                    {
                        id: 'aes-128-encryption',
                        aes128: {
                            uri: keyStorageUri,
                        },
                    },
                ],
            },
        },
    };
    console.log(`[${episodeId}] HLS Job: Transcoder job request payload prepared.`);

    try {
        const [response] = await client.createJob(request);
        console.log(`[${episodeId}] HLS Job: Transcoder job created: ${response.name}`);
        
        let jobSucceeded = false;
        for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 10000)); 
            const [job] = await client.getJob({ name: response.name });
            console.log(`[${episodeId}] HLS Job: Polling job status... Current state: ${job.state}`);

            if (job.state === 'SUCCEEDED') {
                console.log(`[${episodeId}] HLS Job: Transcoder job SUCCEEDED. Manifest URL: ${outputUri}manifest.m3u8`);
                await docRef.update({
                    packagingStatus: 'completed',
                    manifestUrl: `${outputUri}manifest.m3u8`.replace(`gs://${bucket.name}/`, `https://storage.googleapis.com/${bucket.name}/`),
                    keyServerUrl: signedKeyUrl,
                });
                jobSucceeded = true;
                break;
            } else if (job.state === 'FAILED') {
                throw new Error(`Transcoder job failed: ${JSON.stringify(job.error)}`);
            }
        }

        if (!jobSucceeded) {
             throw new Error('Transcoder job timed out after 10 minutes.');
        }

    } catch (error: any) {
        console.error(`[${episodeId}] HLS packaging failed:`, error);
        await docRef.update({ packagingStatus: "failed", aiProcessingError: error.message || 'HLS packaging failed.' });
    }
}


// ==========================================
// [Trigger] 메인 분석 함수 (v2 onDocumentWritten)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change) return;

    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted, skipping.`);
      return;
    }
    
    const afterData = change.after.data() as EpisodeData;
    const beforeData = change.before.exists ? change.before.data() as EpisodeData : null;

    if (afterData.aiProcessingStatus !== 'pending' || (beforeData && beforeData.aiProcessingStatus === 'pending')) {
      return;
    }

    const { episodeId } = event.params;
    const docRef = change.after.ref;
    
    console.log(`✨ [${episodeId}] New analysis job detected. Starting...`);

    await docRef.update({ aiProcessingStatus: "processing" });
    
    const filePath = afterData.filePath;
    if (!filePath) {
      await docRef.update({ aiProcessingStatus: "failed", packagingStatus: "failed", aiProcessingError: "No filePath" });
      return;
    }
    const inputUriForTranscoder = `gs://${bucket.name}/${filePath}`;
    
    // 비디오 AI 분석과 HLS 패키징을 병렬로 실행합니다.
    const aiAnalysisPromise = runAiAnalysis(episodeId, filePath, docRef);
    const hlsPackagingPromise = createHlsPackagingJob(episodeId, inputUriForTranscoder, docRef);

    try {
        await Promise.all([aiAnalysisPromise, hlsPackagingPromise]);
        console.log(`✅ [${episodeId}] All jobs (AI & HLS) completed successfully!`);
    } catch(error: any) {
        // This catch block will now only be hit by unexpected exceptions,
        // as individual job failures are handled within the functions themselves.
        console.error(`❌ [${episodeId}] A critical unexpected error occurred in Promise.all.`, error);
    }
});

async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const modelName = "gemini-2.5-flash";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await localFileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... AI processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

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
      const afterData = (await docRef.get()).data() as EpisodeData;
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
          content: analysisJsonString,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      
      batch.update(docRef, {
        aiProcessingStatus: "completed",
        aiModel: modelName,
        transcript: output.transcript || "",
        aiGeneratedContent: analysisJsonString,
        vttPath: vttPath,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const aiChunkRef = db.collection('episode_ai_chunks').doc(episodeId);
      batch.set(aiChunkRef, aiChunkData);

      await batch.commit();

      console.log(`[${episodeId}] AI analysis succeeded!`);

    } catch (error: any) {
      const detailedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      console.error(`❌ [${episodeId}] AI analysis failed. Detailed error:`, detailedError);
      await docRef.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error)
      });
      // Do not re-throw the error, to allow other parallel promises to continue.
    } finally {
      if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch (e) {} }
      if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
    }
}

// ==========================================
// [Trigger] 파일 삭제 함수 (v2 onDocumentDeleted)
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const { episodeId } = event.params;
    const data = snap.data() as EpisodeData;
    if (!data) return;
    
    // This will delete the entire folder for the episode including video, thumbnails, keys, and packaged content.
    await bucket.deleteFiles({ prefix: `episodes/${episodeId}/` }).catch(() => {});
    
    const aiChunkRef = db.collection('episode_ai_chunks').doc(episodeId);
    await aiChunkRef.delete().catch(() => {});

    console.log(`[DELETE SUCCESS] Cleaned up files and AI chunk for deleted episode ${episodeId}`);
});

interface EpisodeData {
  filePath: string;
  courseId: string;
  aiProcessingStatus?: string;
  packagingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  defaultThumbnailPath?: string;
  customThumbnailPath?: string;
  vttPath?: string;
  [key: string]: any;
}
