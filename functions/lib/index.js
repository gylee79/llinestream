"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFilesOnEpisodeDelete = exports.analyzeVideoOnWrite = void 0;
/**
 * @fileoverview Video Analysis with Gemini & Transcoder API using Firebase Cloud Functions v2.
 * Gemini Model: gemini-1.5-flash
 * Transcoder API for HLS Packaging with AES-128 encryption.
 */
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const video_transcoder_1 = require("@google-cloud/video-transcoder");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
// 0. Firebase Admin & Global Options 초기화
if (!admin.apps.length) {
    admin.initializeApp();
}
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: ["GOOGLE_GENAI_API_KEY"],
    timeoutSeconds: 540, // Set to maximum allowed timeout (9 minutes)
    memory: "2GiB",
    serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();
// 1. MIME Type 도우미
function getMimeType(filePath) {
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
let genAI = null;
let fileManager = null;
let transcoderClient = null;
function initializeTools() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
        throw new Error("GOOGLE_GENAI_API_KEY is missing!");
    if (!genAI)
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    if (!fileManager)
        fileManager = new server_1.GoogleAIFileManager(apiKey);
    if (!transcoderClient)
        transcoderClient = new video_transcoder_1.TranscoderServiceClient();
    return { genAI, fileManager, transcoderClient };
}
// 3. HLS Packaging with Transcoder API (AES-128) - Private Key with Placeholder URI
async function createHlsPackagingJob(episodeId, inputUri, docRef) {
    try {
        await docRef.update({ packagingStatus: "processing", packagingError: null });
        console.log(`[${episodeId}] HLS Job: Set status to 'processing'.`);
        const { transcoderClient: client } = initializeTools();
        const projectId = await client.getProjectId();
        const location = 'us-central1';
        const outputFolder = `episodes/${episodeId}/packaged/`;
        const outputUri = `gs://${bucket.name}/${outputFolder}`;
        // 1. Generate a 16-byte AES-128 key.
        const aesKey = crypto.randomBytes(16);
        const keyFileName = 'enc.key';
        const keyStoragePath = `episodes/${episodeId}/keys/${keyFileName}`;
        const keyFile = bucket.file(keyStoragePath);
        // 2. Save the key to a private location in Storage.
        console.log(`[${episodeId}] HLS Job: Uploading private AES-128 key to ${keyStoragePath}`);
        await keyFile.save(aesKey, { contentType: 'application/octet-stream', private: true });
        // 3. Create a unique, non-public placeholder URI for the manifest.
        const keyUriPlaceholder = `https://llinestream.internal/keys/${episodeId}`;
        console.log(`[${episodeId}] HLS Job: Using placeholder URI for manifest: ${keyUriPlaceholder}`);
        // 4. Configure the Transcoder job.
        const request = {
            parent: `projects/${projectId}/locations/${location}`,
            job: {
                inputUri,
                outputUri,
                config: {
                    muxStreams: [
                        {
                            key: 'video-sd-ts',
                            container: 'ts',
                            elementaryStreams: ['sd-video-stream'],
                            segmentSettings: {
                                individualSegments: true,
                                segmentDuration: { seconds: 4 },
                                encryption: {
                                    aes128: { uri: keyUriPlaceholder } // Use the placeholder URI
                                }
                            },
                        },
                        {
                            key: 'audio-ts',
                            container: 'ts',
                            elementaryStreams: ['audio-stream'],
                            segmentSettings: {
                                individualSegments: true,
                                segmentDuration: { seconds: 4 },
                                encryption: {
                                    aes128: { uri: keyUriPlaceholder } // Use the placeholder URI
                                }
                            },
                        }
                    ],
                    elementaryStreams: [
                        { key: 'sd-video-stream', videoStream: { h264: {
                                    heightPixels: 480,
                                    widthPixels: 854,
                                    bitrateBps: 1000000,
                                    frameRate: 30,
                                    gopDuration: { seconds: 2 }
                                } } },
                        { key: 'audio-stream', audioStream: { codec: 'aac', bitrateBps: 128000 } },
                    ],
                    manifests: [{ fileName: 'manifest.m3u8', type: 'HLS', muxStreams: ['video-sd-ts', 'audio-ts'] }],
                },
            },
        };
        console.log(`[${episodeId}] HLS Job: Creating Transcoder job...`);
        const [createJobResponse] = await client.createJob(request);
        if (!createJobResponse.name) {
            throw new Error('Transcoder job creation failed, no job name returned.');
        }
        const jobName = createJobResponse.name;
        console.log(`[${episodeId}] HLS Job: Transcoder job created successfully. Job name: ${jobName}`);
        // 5. Poll for job completion.
        const POLLING_INTERVAL = 15000;
        const MAX_POLLS = 35;
        let jobSucceeded = false;
        for (let i = 0; i < MAX_POLLS; i++) {
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            const [job] = await client.getJob({ name: jobName });
            console.log(`[${episodeId}] HLS Job: Polling job status... (Attempt ${i + 1}/${MAX_POLLS}). Current state: ${job.state}`);
            if (job.state === 'SUCCEEDED') {
                console.log(`[${episodeId}] HLS Job: SUCCEEDED.`);
                // 6. On success, store the path to the manifest, NOT a full URL.
                await docRef.update({
                    packagingStatus: 'completed',
                    manifestUrl: `${outputFolder}manifest.m3u8`, // Store the path only
                    packagingError: null,
                });
                console.log(`[${episodeId}] HLS Job: Firestore document updated to 'completed'.`);
                jobSucceeded = true;
                break;
            }
            else if (job.state === 'FAILED') {
                const errorMessage = `Transcoder job failed: ${JSON.stringify(job.error, null, 2)}`;
                throw new Error(errorMessage);
            }
        }
        if (!jobSucceeded) {
            throw new Error(`Transcoder job timed out after ${MAX_POLLS * POLLING_INTERVAL / 1000 / 60} minutes.`);
        }
    }
    catch (error) {
        console.error(`[${episodeId}] HLS packaging process failed critically. Error:`, error);
        await docRef.update({
            packagingStatus: "failed",
            packagingError: error.message || 'An unknown error occurred during HLS packaging.'
        });
    }
}
// ==========================================
// [Trigger] 메인 분석 함수 (v2 onDocumentWritten)
// ==========================================
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        console.log(`[${event.params.episodeId}] Document deleted, skipping.`);
        return;
    }
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    if (afterData.aiProcessingStatus !== 'pending' || (beforeData && beforeData.aiProcessingStatus === afterData.aiProcessingStatus)) {
        return;
    }
    const { episodeId } = event.params;
    const docRef = change.after.ref;
    console.log(`✨ [${episodeId}] New analysis job detected. Starting...`);
    await docRef.update({ aiProcessingStatus: "processing" });
    const filePath = afterData.filePath;
    if (!filePath) {
        await docRef.update({
            aiProcessingStatus: "failed",
            packagingStatus: "failed",
            aiProcessingError: "No filePath found in document.",
            packagingError: "No filePath found in document."
        });
        return;
    }
    const inputUriForTranscoder = `gs://${bucket.name}/${filePath}`;
    const aiAnalysisPromise = runAiAnalysis(episodeId, filePath, docRef);
    const hlsPackagingPromise = createHlsPackagingJob(episodeId, inputUriForTranscoder, docRef);
    try {
        await Promise.allSettled([aiAnalysisPromise, hlsPackagingPromise]);
        console.log(`✅ [${episodeId}] All jobs (AI & HLS) have finished their execution.`);
    }
    catch (error) {
        console.error(`❌ [${episodeId}] A critical unexpected error occurred in Promise.all. This should not happen.`, error);
    }
});
async function runAiAnalysis(episodeId, filePath, docRef) {
    const modelName = "gemini-1.5-flash";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile = null;
    try {
        await bucket.file(filePath).download({ destination: tempFilePath });
        const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
            mimeType: getMimeType(filePath),
            displayName: episodeId,
        });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const freshFile = await localFileManager.getFile(uploadedFile.name);
            state = freshFile.state;
            console.log(`... AI processing status: ${state}`);
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI file processing failed.");
        console.log(`[${episodeId}] Calling Gemini model...`);
        const model = localGenAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: generative_ai_1.SchemaType.OBJECT,
                    properties: {
                        transcript: { type: generative_ai_1.SchemaType.STRING, description: "영상의 전체 내용을 한국어로 번역한 대본입니다. 영상이 영어라도 반드시 한국어로 번역해주세요." },
                        summary: { type: generative_ai_1.SchemaType.STRING, description: "영상 전체 내용에 대한 상세하고 구조화된 한국어 요약문입니다." },
                        timeline: {
                            type: generative_ai_1.SchemaType.ARRAY,
                            description: "시간대별 주요 이벤트 및 화면에 대한 상세 설명입니다.",
                            items: {
                                type: generative_ai_1.SchemaType.OBJECT,
                                properties: {
                                    startTime: { type: generative_ai_1.SchemaType.STRING, description: "이벤트 시작 시간. 반드시 HH:MM:SS.mmm 형식이어야 합니다." },
                                    endTime: { type: generative_ai_1.SchemaType.STRING, description: "이벤트 종료 시간. 반드시 HH:MM:SS.mmm 형식이어야 합니다." },
                                    subtitle: { type: generative_ai_1.SchemaType.STRING, description: "해당 시간대의 핵심 대사 또는 자막입니다. (한국어)" },
                                    description: { type: generative_ai_1.SchemaType.STRING, description: "해당 시간대에 화면에 나타나는 시각적 요소(인물, 사물, 텍스트, 슬라이드 내용 등)와 상황에 대한 상세한 설명입니다. (한국어)" }
                                },
                                required: ["startTime", "endTime", "subtitle", "description"]
                            }
                        },
                        keywords: { type: generative_ai_1.SchemaType.ARRAY, description: "영상 콘텐츠의 핵심 키워드 목록입니다. (한국어)", items: { type: generative_ai_1.SchemaType.STRING } }
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
                .map((item) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
                .join('\n\n')}`;
            const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
            fs.writeFileSync(vttTempPath, vttContent);
            vttPath = `episodes/${episodeId}/subtitles/${episodeId}.vtt`;
            await bucket.upload(vttTempPath, {
                destination: vttPath,
                metadata: { contentType: 'text/vtt' },
            });
            if (fs.existsSync(vttTempPath))
                fs.unlinkSync(vttTempPath);
            console.log(`[${episodeId}] VTT subtitle file created.`);
        }
        const analysisJsonString = JSON.stringify(output);
        const afterData = (await docRef.get()).data();
        const courseDoc = await db.collection('courses').doc(afterData.courseId).get();
        if (!courseDoc.exists)
            throw new Error(`Course not found for episode ${episodeId}`);
        const classificationDoc = await db.collection('classifications').doc(courseDoc.data().classificationId).get();
        if (!classificationDoc.exists)
            throw new Error(`Classification not found for course ${courseDoc.id}`);
        const fieldId = classificationDoc.data().fieldId;
        const aiChunkData = {
            episodeId,
            courseId: afterData.courseId,
            classificationId: courseDoc.data().classificationId,
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
    }
    catch (error) {
        const detailedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
        console.error(`❌ [${episodeId}] AI analysis failed. Detailed error:`, detailedError);
        await docRef.update({
            aiProcessingStatus: "failed",
            aiProcessingError: error.message || String(error)
        });
    }
    finally {
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            }
            catch (e) { }
        }
        if (uploadedFile) {
            try {
                await localFileManager.deleteFile(uploadedFile.name);
            }
            catch (e) { }
        }
    }
}
// ==========================================
// [Trigger] 파일 삭제 함수 (v2 onDocumentDeleted)
// ==========================================
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const deletedData = event.data?.data();
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    // 1. Delete all files in the episode's main storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        console.log(`[DELETE ACTION] Deleting all files with prefix: ${prefix}`);
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    // 2. Delete the corresponding document from the AI chunks collection
    try {
        const aiChunkRef = db.collection('episode_ai_chunks').doc(episodeId);
        await aiChunkRef.delete();
        console.log(`[DELETE SUCCESS] AI chunk for episode ${episodeId} deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete AI chunk for episode ${episodeId}.`, error);
    }
    // 3. (Optional but good practice) Explicitly delete specific files if paths were stored
    if (deletedData) {
        console.log(`[ADDITIONAL CLEANUP] Using data from deleted doc for explicit cleanup.`);
        await deleteStorageFileByPath(storage, deletedData.filePath);
        await deleteStorageFileByPath(storage, deletedData.defaultThumbnailPath);
        await deleteStorageFileByPath(storage, deletedData.customThumbnailPath);
        await deleteStorageFileByPath(storage, deletedData.vttPath);
    }
    console.log(`[DELETE FINISHED] Cleanup process finished for episode ${episodeId}.`);
});
const deleteStorageFileByPath = async (storage, filePath) => {
    if (!filePath) {
        console.warn(`[SKIP DELETE] No file path provided.`);
        return;
    }
    try {
        const file = storage.bucket().file(filePath);
        const [exists] = await file.exists();
        if (exists) {
            console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
            await file.delete();
            console.log(`[DELETE SUCCESS] File deleted: ${filePath}`);
        }
        else {
            console.log(`[SKIP DELETE] File does not exist, skipping deletion: ${filePath}`);
        }
    }
    catch (error) {
        // Suppress "Not Found" errors during cleanup, as they are not critical.
        if (error.code === 404) {
            console.log(`[SKIP DELETE] File not found during cleanup, which is acceptable: ${filePath}`);
            return;
        }
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};
//# sourceMappingURL=index.js.map