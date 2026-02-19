"use strict";
'use server';
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFilesOnEpisodeDelete = exports.aiAnalysisTrigger = exports.videoPipelineTrigger = void 0;
/**
 * @fileoverview LlineStream Video Processing Pipeline v9.1 (Extreme Tracking & Stability)
 *
 * Implements a robust, decoupled, two-stage workflow with detailed step-by-step
 * tracking and granular error handling to ensure stability and debuggability.
 */
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs/promises"));
const crypto = __importStar(require("crypto"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const { path: ffprobePath } = require('ffprobe-static');
// 0. Initialize SDKs and Global Configuration
if (ffmpeg_static_1.default) {
    fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
}
fluent_ffmpeg_1.default.setFfprobePath(ffprobePath);
if (admin.apps.length === 0) {
    admin.initializeApp();
}
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: ["GOOGLE_GENAI_API_KEY", "KEK_SECRET"],
    timeoutSeconds: 540, // 9 minutes
    memory: "4GiB",
    cpu: 2,
});
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();
const SEGMENT_DURATION_SEC = 4;
// 1. UTILITY & HELPER FUNCTIONS (WITH EXTREME TRACKING)
// =======================================================
/**
 * Updates the pipeline status in Firestore and logs the step to the console.
 * This is the core of the tracking system.
 */
async function updatePipelineStatus(docRef, step, progress, extraData = {}) {
    console.info(`[${docRef.id}] [STEP: ${step}] Progress: ${progress}%`);
    await docRef.update({
        'status.step': step,
        'status.progress': progress,
        'status.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        ...extraData
    });
}
/**
 * Records a catastrophic failure in Firestore, including the exact step and error details.
 */
async function failPipeline(docRef, failedStep, error) {
    const rawError = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack available.';
    console.error(`[${docRef.id}] ❌ [FAILURE at STEP: ${failedStep}]`, rawError, errorStack);
    await docRef.update({
        'status.pipeline': 'failed',
        'status.playable': false,
        'status.progress': 100, // Mark as finished, but failed
        'status.error': {
            step: failedStep,
            message: rawError,
            stack: errorStack,
            ts: admin.firestore.FieldValue.serverTimestamp(),
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error))
        },
        'ai.status': 'blocked',
        'ai.error': { code: 'PIPELINE_FAILED', message: '비디오 처리 파이프라인 실패로 AI 분석이 차단되었습니다.' }
    });
}
// 2. STAGE 1: VIDEO CORE PROCESSING TRIGGER
// ==========================================
exports.videoPipelineTrigger = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists) {
        console.log("Document deleted or does not exist, skipping trigger.");
        return;
    }
    const docRef = change.after.ref;
    const episodeId = docRef.id; // CRITICAL FIX: Get ID directly from the document reference.
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    // Trigger only if the pipeline status is newly set to 'pending'.
    if (afterData.status?.pipeline !== 'pending' || beforeData?.status?.pipeline === 'pending') {
        return;
    }
    let currentStep = 'preparing';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-${episodeId}-`));
    try {
        console.log(`[${episodeId}] [START] Video pipeline trigger initiated.`);
        await updatePipelineStatus(docRef, 'preparing', 5);
        const { rawPath } = afterData.storage;
        if (!rawPath || !(await bucket.file(rawPath).exists())[0]) {
            throw new Error(`storage.rawPath is missing or file does not exist in Storage: ${rawPath}`);
        }
        // --- Step: Downloading Raw File ---
        const localInputPath = path.join(tempDir, 'original_video');
        try {
            currentStep = 'downloading_raw';
            await updatePipelineStatus(docRef, currentStep, 10);
            await bucket.file(rawPath).download({ destination: localInputPath });
        }
        catch (e) {
            throw { step: currentStep, error: e };
        }
        // --- Step: FFprobe Check ---
        let probeData;
        try {
            currentStep = 'ffprobe_check';
            await updatePipelineStatus(docRef, currentStep, 15);
            probeData = await new Promise((res, rej) => fluent_ffmpeg_1.default.ffprobe(localInputPath, (err, data) => err ? rej(err) : res(data)));
        }
        catch (e) {
            throw { step: currentStep, error: e };
        }
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;
        // --- Step: FFMPEG Transcoding & Segmenting ---
        const fragmentedMp4Path = path.join(tempDir, 'frag.mp4');
        try {
            currentStep = 'ffmpeg_transcoding';
            await updatePipelineStatus(docRef, currentStep, 20);
            await new Promise((resolve, reject) => {
                const command = (0, fluent_ffmpeg_1.default)(localInputPath).videoCodec('libx264').outputOptions(['-vf', 'scale=-2:1080']);
                if (audioStream)
                    command.audioCodec('aac');
                command.outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                    .toFormat('mp4').on('error', reject).on('end', () => resolve()).save(fragmentedMp4Path);
            });
            currentStep = 'dash_segmenting';
            await updatePipelineStatus(docRef, currentStep, 35);
            await new Promise((resolve, reject) => {
                (0, fluent_ffmpeg_1.default)(fragmentedMp4Path).outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                    .on('error', reject).on('end', () => resolve()).save(path.join(tempDir, 'manifest.mpd'));
            });
        }
        catch (e) {
            throw { step: currentStep, error: e };
        }
        // --- Step: Thumbnail Extraction ---
        const defaultThumbnailPath = path.join(tempDir, 'default_thumb.jpg');
        try {
            currentStep = 'thumbnail';
            await updatePipelineStatus(docRef, currentStep, 45);
            await new Promise((resolve, reject) => {
                (0, fluent_ffmpeg_1.default)(localInputPath).seekInput(duration * 0.5).frames(1).output(defaultThumbnailPath)
                    .on('error', reject).on('end', () => resolve()).run();
            });
        }
        catch (e) {
            throw { step: currentStep, error: e };
        }
        // --- Step: Encrypting Segments ---
        const processedSegments = [];
        try {
            currentStep = 'encrypting';
            await updatePipelineStatus(docRef, currentStep, 55);
            const createdFiles = await fs.readdir(tempDir);
            const segmentNames = ['init.mp4', ...createdFiles.filter(f => f.startsWith('segment_')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
            const kek = Buffer.from(process.env.KEK_SECRET, 'base64');
            const masterKey = crypto.randomBytes(32);
            const encryptedBasePath = `episodes/${episodeId}/segments/`;
            for (const fileName of segmentNames) {
                const content = await fs.readFile(path.join(tempDir, fileName));
                const iv = crypto.randomBytes(12);
                const storagePath = `${encryptedBasePath}${fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc')}`;
                const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
                cipher.setAAD(Buffer.from(`path:${storagePath}`));
                const finalBuffer = Buffer.concat([iv, cipher.update(content), cipher.final(), cipher.getAuthTag()]);
                await bucket.file(storagePath).save(finalBuffer);
                processedSegments.push({ name: fileName, path: storagePath });
            }
            // Save the master key after all segments are successfully encrypted & uploaded
            currentStep = 'saving_keys';
            await updatePipelineStatus(docRef, currentStep, 80);
            const keyId = `vidkey_${episodeId}`;
            const kekIv = crypto.randomBytes(12);
            const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
            const encryptedMasterKeyBlob = Buffer.concat([kekIv, kekCipher.update(masterKey), kekCipher.final(), kekCipher.getAuthTag()]);
            await db.collection('video_keys').doc(keyId).set({ encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'), kekVersion: 1, videoId: episodeId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        catch (e) {
            throw { step: currentStep, error: e };
        }
        // --- Step: Manifest Creation & Uploading ---
        currentStep = 'manifest';
        await updatePipelineStatus(docRef, currentStep, 90);
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        const manifest = {
            codec: audioStream ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` : `video/mp4; codecs="avc1.42E01E"`,
            duration: Math.round(duration),
            init: processedSegments.find(s => s.name === 'init.mp4')?.path,
            segments: processedSegments.filter(s => s.name !== 'init.mp4').map(s => ({ path: s.path })),
        };
        await bucket.file(manifestPath).save(JSON.stringify(manifest));
        currentStep = 'uploading';
        await updatePipelineStatus(docRef, currentStep, 95);
        const defaultThumbStoragePath = `episodes/${episodeId}/thumbnails/default.jpg`;
        await bucket.upload(defaultThumbnailPath, { destination: defaultThumbStoragePath });
        const defaultThumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(defaultThumbStoragePath)}?alt=media`;
        // --- Step: Finalizing ---
        currentStep = 'completed';
        const encryptionInfo = { algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, keyId: `vidkey_${episodeId}`, kekVersion: 1, aadMode: "path", segmentDurationSec: 4, fragmentEncrypted: true };
        await updatePipelineStatus(docRef, currentStep, 100, {
            duration: Math.round(duration),
            'storage.encryptedBasePath': `episodes/${episodeId}/segments/`,
            'storage.manifestPath': manifestPath,
            'thumbnails.default': defaultThumbUrl,
            'thumbnails.defaultPath': defaultThumbStoragePath,
            'thumbnailUrl': afterData.thumbnails.custom || defaultThumbUrl,
            'encryption': encryptionInfo,
            'status.pipeline': 'completed',
            'status.playable': true,
            'status.error': null,
            'ai.status': 'queued', // Signal for the next function
        });
        console.log(`[${episodeId}] ✅ [SUCCESS] Video pipeline finished.`);
    }
    catch (e) {
        const failedStep = e.step || currentStep;
        const error = e.error || e;
        await failPipeline(docRef, failedStep, error);
    }
    finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
            console.error(`[${episodeId}] ⚠️ Failed to clean up temp directory ${tempDir}:`, err);
        });
    }
});
// 3. STAGE 2 & 3: AI INTELLIGENCE & CLEANUP TRIGGER
// ==================================================
exports.aiAnalysisTrigger = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists)
        return;
    const docRef = change.after.ref;
    const episodeId = docRef.id; // CRITICAL FIX
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    if (afterData.ai?.status !== 'queued' || beforeData?.ai?.status === 'queued') {
        return;
    }
    console.log(`[${episodeId}] [START] AI analysis trigger initiated.`);
    const { rawPath } = afterData.storage;
    if (!rawPath) {
        console.error(`[${episodeId}] ❌ AI Stage Failed: rawPath is missing.`);
        await docRef.update({ 'ai.status': 'failed', 'ai.error': { code: 'RAW_PATH_MISSING', message: 'Original video file path was missing for AI analysis.' } });
        return;
    }
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
        console.error(`[${episodeId}] ❌ AI Stage Failed: GOOGLE_GENAI_API_KEY is not configured.`);
        await docRef.update({ 'ai.status': 'failed', 'ai.error': { code: 'MISSING_API_KEY', message: 'AI API 키가 설정되지 않았습니다.' } });
        return;
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const fileManager = new server_1.GoogleAIFileManager(apiKey);
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile = null;
    try {
        await docRef.update({ 'ai.status': 'processing', 'ai.model': 'gemini-2.5-flash' });
        console.log(`[${episodeId}] [STEP: downloading_raw_for_ai]`);
        await bucket.file(rawPath).download({ destination: tempFilePath });
        console.log(`[${episodeId}] [STEP: uploading_to_ai]`);
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4' });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] [STEP: processing_in_ai]`);
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const freshFile = await fileManager.getFile(uploadedFile.name);
            state = freshFile.state;
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI file processing failed.");
        console.log(`[${episodeId}] [STEP: generating_content]`);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const prompt = "상세 요약(summary), 타임라인(timeline), 전체 대본(transcript) 뿐만 아니라, AI 검색/채팅을 위한 핵심 키워드(keywords)와 주제(topics)를 JSON으로 추출할 것. 모든 결과는 한국어로 작성되어야 합니다.";
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        const output = JSON.parse(result.response.text());
        console.log(`[${episodeId}] [STEP: saving_ai_results]`);
        const searchDataPath = `episodes/${episodeId}/ai/search_data.json`;
        await bucket.file(searchDataPath).save(JSON.stringify(output));
        await docRef.update({ 'ai.status': 'completed', 'ai.resultPaths': { search_data: searchDataPath }, 'ai.error': null });
        console.log(`[${episodeId}] ✅ [SUCCESS] AI analysis finished.`);
    }
    catch (e) {
        console.error(`[${episodeId}] ❌ AI Stage Failed.`, e);
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { code: 'AI_PROCESSING_FAILED', message: e.message || 'Unknown AI error', stack: e.stack }
        });
    }
    finally {
        console.log(`[${episodeId}] [STEP: cleanup]`);
        if (uploadedFile) {
            try {
                await fileManager.deleteFile(uploadedFile.name);
            }
            catch (e) { }
        }
        try {
            await fs.rm(tempFilePath, { force: true });
        }
        catch (e) { }
        await bucket.file(rawPath).delete().catch(e => console.error(`Failed to delete rawPath ${rawPath}`, e));
        await docRef.update({ 'storage.rawPath': admin.firestore.FieldValue.delete() });
        console.log(`[${episodeId}] [END] Cleanup finished.`);
    }
});
// 4. DELETION TRIGGER
// ===================
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const episodeId = event.params.episodeId;
    const episode = event.data?.data();
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    const prefix = `episodes/${episodeId}/`;
    await bucket.deleteFiles({ prefix }).catch(e => console.error(`Failed to delete files for episode ${episodeId}`, e));
    const keyId = episode?.encryption?.keyId;
    if (keyId) {
        await db.collection('video_keys').doc(keyId).delete().catch(e => console.error(`Failed to delete key ${keyId}`, e));
    }
});
//# sourceMappingURL=index.js.map