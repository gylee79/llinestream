"use strict";
/**
 * @fileoverview LlineStream Video Processing Pipeline v6.2
 *
 * Implements a decoupled, two-stage workflow for video processing and AI analysis
 * to prevent Cloud Function timeouts and improve reliability.
 *
 * Required NPM Packages for this file:
 * "dependencies": {
 *   "@google/generative-ai": "^0.23.0",
 *   "firebase-admin": "^12.0.0",
 *   "firebase-functions": "^5.0.1",
 *   "fluent-ffmpeg": "^2.1.3",
 *   "ffmpeg-static": "^5.2.0",
 *   "ffprobe-static": "^3.1.0"
 * },
 * "devDependencies": {
 *   "@types/fluent-ffmpeg": "^2.1.24",
 *   "@types/node": "^20.14.2",
 *   "typescript": "^5.0.0"
 * }
 */
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
exports.runAiAnalysis = runAiAnalysis;
// --- Firebase and Node.js Imports ---
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs/promises"));
const crypto = __importStar(require("crypto"));
// --- AI and Media Processing Imports ---
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const { path: ffprobePath } = require('ffprobe-static');
// 0. Initialize SDKs and Global Configuration
// ===============================================
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
    timeoutSeconds: 540,
    memory: "4GiB",
    cpu: 2,
});
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();
const SEGMENT_DURATION_SEC = 4;
// 1. Utility & Helper Functions
// ===============================
let genAI = null;
let fileManager = null;
let cachedKEK = null;
async function loadKEK() {
    if (cachedKEK)
        return cachedKEK;
    const kekSecret = process.env.KEK_SECRET;
    if (!kekSecret)
        throw new Error("CRITICAL: KEK_SECRET is not configured.");
    const key = Buffer.from(kekSecret, 'base64');
    if (key.length !== 32)
        throw new Error(`Invalid KEK format. Expected 32-byte key, received ${key.length} bytes.`);
    cachedKEK = key;
    return cachedKEK;
}
function initializeTools() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
        throw new Error("GOOGLE_GENAI_API_KEY is missing!");
    if (!genAI)
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    if (!fileManager)
        fileManager = new server_1.GoogleAIFileManager(apiKey);
    return { genAI, fileManager, getKek: loadKEK };
}
async function updatePipelineStatus(docRef, status) {
    await docRef.update({
        'status.pipeline': status.pipeline,
        'status.step': status.step,
        'status.progress': status.progress,
        'status.playable': status.playable,
        'status.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'status.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp(),
    });
}
async function failPipeline(docRef, step, error, hint) {
    const rawError = (error instanceof Error) ? error.message : String(error);
    await docRef.update({
        'status.pipeline': 'failed',
        'status.step': step,
        'status.playable': false,
        'status.progress': 100,
        'status.error': {
            step: step,
            code: error.code || 'UNKNOWN',
            message: rawError,
            hint: hint || '해당 단계에서 처리 중 오류가 발생했습니다.',
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
            ts: admin.firestore.FieldValue.serverTimestamp()
        },
        'ai.status': 'blocked',
        'ai.error': {
            code: 'PIPELINE_FAILED',
            message: '비디오 처리 파이프라인이 실패하여 AI 분석을 건너뜁니다.',
            ts: admin.firestore.FieldValue.serverTimestamp()
        }
    });
    console.error(`[${docRef.id}] ❌ Pipeline Failed at step '${step}':`, rawError);
}
// 2. Core Logic: Video Processing
// ===============================================
async function processAndEncryptVideo(episodeId, inputFilePath, docRef) {
    const tempInputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-in-${episodeId}-`));
    const tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-out-${episodeId}-`));
    const localInputPath = path.join(tempInputDir, 'original_video');
    try {
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'validate', progress: 5, playable: false });
        await bucket.file(inputFilePath).download({ destination: localInputPath });
        const probeData = await new Promise((resolve, reject) => {
            fluent_ffmpeg_1.default.ffprobe(localInputPath, (err, data) => err ? reject(err) : resolve(data));
        }).catch(err => { throw { step: 'validate', error: err }; });
        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        if (!videoStream)
            throw { step: 'validate', error: new Error("No video stream found.") };
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;
        const codecString = audioStream ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` : `video/mp4; codecs="avc1.42E01E"`;
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'ffmpeg', progress: 15, playable: false });
        const fragmentedMp4Path = path.join(tempInputDir, 'frag.mp4');
        await new Promise((resolve, reject) => {
            const command = (0, fluent_ffmpeg_1.default)(localInputPath).videoCodec('libx264');
            if (audioStream)
                command.audioCodec('aac');
            command
                .outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4')
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(fragmentedMp4Path);
        }).catch(err => { throw { step: 'ffmpeg', error: err, hint: "Video transcoding failed." }; });
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(fragmentedMp4Path)
                .outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(path.join(tempOutputDir, 'manifest.mpd'));
        }).catch(err => { throw { step: 'ffmpeg', error: err, hint: "DASH segmentation failed." }; });
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'encrypt', progress: 40, playable: false });
        const createdFiles = await fs.readdir(tempOutputDir);
        const mediaSegmentNames = createdFiles.filter(f => f.startsWith('segment_') && f.endsWith('.m4s')).sort((a, b) => parseInt(a.match(/(\d+)/)?.[0] || '0') - parseInt(b.match(/(\d+)/)?.[0] || '0'));
        const allSegmentsToProcess = ['init.mp4', ...mediaSegmentNames];
        const masterKey = crypto.randomBytes(32);
        const encryptedBasePath = `episodes/${episodeId}/segments/`;
        const processedSegmentPaths = [];
        for (const fileName of allSegmentsToProcess) {
            const localFilePath = path.join(tempOutputDir, fileName);
            const content = await fs.readFile(localFilePath);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            const outputFileName = fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc');
            const storagePath = `${encryptedBasePath}${outputFileName}`;
            const aad = Buffer.from(`path:${storagePath}`);
            cipher.setAAD(aad);
            const encryptedContent = Buffer.concat([cipher.update(content), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const finalBuffer = Buffer.concat([iv, encryptedContent, authTag]);
            await bucket.file(storagePath).save(finalBuffer, { contentType: 'application/octet-stream' });
            processedSegmentPaths.push({ name: fileName, path: storagePath });
        }
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'manifest', progress: 85, playable: false });
        const initSegment = processedSegmentPaths.find(s => s.name === 'init.mp4');
        if (!initSegment)
            throw { step: 'manifest', error: new Error("Manifest creation failed: init segment path not found.") };
        const manifest = {
            codec: codecString,
            duration: Math.round(duration),
            init: initSegment.path,
            segments: processedSegmentPaths.filter(s => s.name !== 'init.mp4').map(s => ({ path: s.path })),
        };
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), { contentType: 'application/json' });
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'keys', progress: 95, playable: false });
        const kek = await loadKEK();
        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKey = Buffer.concat([kekCipher.update(masterKey), kekCipher.final()]);
        const kekAuthTag = kekCipher.getAuthTag();
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, encryptedMasterKey, kekAuthTag]);
        await db.collection('video_keys').doc(keyId).set({
            keyId, videoId: episodeId,
            encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'),
            kekVersion: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await docRef.update({
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath,
            'storage.manifestPath': manifestPath,
            'encryption': {
                algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16,
                keyId: keyId, kekVersion: 1, aadMode: "path",
                segmentDurationSec: SEGMENT_DURATION_SEC, fragmentEncrypted: true
            },
            'status.pipeline': 'completed', 'status.step': 'done',
            'status.progress': 100, 'status.playable': true, 'status.error': null,
            'status.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
            'status.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp(),
            'ai.status': 'queued',
        });
        console.log(`[${episodeId}] ✅ Video Pipeline complete.`);
        return true;
    }
    catch (error) {
        await failPipeline(docRef, error.step || 'unknown', error.error || error, error.hint);
        return false;
    }
    finally {
        await fs.rm(tempInputDir, { recursive: true, force: true }).catch(() => { });
        await fs.rm(tempOutputDir, { recursive: true, force: true }).catch(() => { });
    }
}
// 3. Core Logic: AI Analysis
// ===============================================
async function runAiAnalysis(episodeId, docRef, episodeData) {
    const modelName = "gemini-2.5-flash";
    try {
        console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
        if (episodeData.status.pipeline !== 'completed' || !episodeData.status.playable || !episodeData.storage.rawPath) {
            await docRef.update({ 'ai.status': 'blocked', 'ai.error': { code: 'AI_GUARD_BLOCKED', message: 'Video pipeline did not complete successfully or rawPath is missing.', ts: admin.firestore.FieldValue.serverTimestamp() } });
            console.warn(`[${episodeId}] ⚠️ AI analysis blocked. Pipeline status: ${episodeData.status.pipeline}, Playable: ${episodeData.status.playable}`);
            return false;
        }
        await docRef.update({ 'ai.status': 'processing', 'ai.model': modelName });
        const { genAI, fileManager } = initializeTools();
        const tempFilePath = path.join(os.tmpdir(), `ai-in-${episodeId}`);
        let uploadedFile = null;
        try {
            await bucket.file(episodeData.storage.rawPath).download({ destination: tempFilePath });
            const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4', displayName: episodeId });
            uploadedFile = uploadResponse.file;
            let state = uploadedFile.state;
            while (state === server_1.FileState.PROCESSING) {
                await new Promise(resolve => setTimeout(resolve, 10000)); // Increased delay for AI file processing
                const freshFile = await fileManager.getFile(uploadedFile.name);
                state = freshFile.state;
            }
            if (state === server_1.FileState.FAILED)
                throw new Error("Google AI file processing failed.");
            const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });
            const prompt = `Analyze this video. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. Output MUST be a JSON object with keys "summary", "transcript", "timeline". Timeline items must have "startTime", "endTime", "subtitle", "description". ALL OUTPUT MUST BE IN KOREAN.`;
            const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
            const rawText = result.response.text();
            let output;
            try {
                const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
                output = JSON.parse(jsonString);
            }
            catch (jsonError) {
                throw new Error(`AI response JSON parsing failed: ${jsonError.message}.`);
            }
            const summaryPath = `episodes/${episodeId}/ai/summary.json`;
            await bucket.file(summaryPath).save(JSON.stringify({ summary: output.summary, timeline: output.timeline }), { contentType: 'application/json' });
            const transcriptPath = `episodes/${episodeId}/ai/transcript.txt`;
            await bucket.file(transcriptPath).save(output.transcript || "", { contentType: 'text/plain' });
            await docRef.update({
                'ai.status': 'completed',
                'ai.resultPaths': { summary: summaryPath, transcript: transcriptPath },
                'ai.error': null,
            });
            console.log(`[${episodeId}] ✅ AI analysis succeeded!`);
            return true;
        }
        catch (error) {
            await docRef.update({
                'ai.status': 'failed',
                'ai.error': { code: 'AI_PROCESSING_FAILED', message: error.message || String(error), raw: JSON.stringify(error, Object.getOwnPropertyNames(error)), ts: admin.firestore.FieldValue.serverTimestamp() }
            });
            console.error(`❌ [${episodeId}] AI analysis failed.`, error);
            return false;
        }
        finally {
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
        }
    }
    catch (e) {
        console.error(`[${episodeId}] UNHANDLED EXCEPTION in runAiAnalysis:`, e);
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { code: 'UNHANDLED_EXCEPTION', message: e.message || "An unknown error occurred during AI analysis startup.", raw: JSON.stringify(e, Object.getOwnPropertyNames(e)), ts: admin.firestore.FieldValue.serverTimestamp() }
        });
        return false;
    }
}
const deleteStorageFileByPath = async (filePath) => {
    if (!filePath)
        return;
    try {
        const file = bucket.file(filePath);
        if ((await file.exists())[0]) {
            await file.delete();
        }
    }
    catch (error) {
        console.error(`Could not delete storage file at path ${filePath}.`, error);
    }
};
// 4. Cloud Function Triggers
// ===============================================
exports.videoPipelineTrigger = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const change = event.data;
    if (!change || !change.after.exists)
        return;
    const docRef = change.after.ref;
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    if (!process.env.KEK_SECRET || !process.env.GOOGLE_GENAI_API_KEY) {
        console.error(`[${episodeId}] CRITICAL: Required secrets are missing. Function cannot start.`);
        return;
    }
    if (afterData.status?.pipeline === 'queued' && beforeData?.status?.pipeline !== 'queued') {
        console.log(`✨ [${episodeId}] Video pipeline job detected. Starting process...`);
        await processAndEncryptVideo(episodeId, afterData.storage.rawPath, docRef);
    }
});
exports.aiAnalysisTrigger = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const change = event.data;
    if (!change || !change.after.exists || !change.before.exists)
        return;
    const docRef = change.after.ref;
    const afterData = change.after.data();
    const beforeData = change.before.data();
    if (afterData.status?.pipeline === 'completed' && beforeData.status?.pipeline !== 'completed') {
        console.log(`✅ [${episodeId}] Video pipeline finished. Starting AI analysis...`);
        const success = await runAiAnalysis(episodeId, docRef, afterData);
        if (success) {
            if (afterData.storage.rawPath) {
                await deleteStorageFileByPath(afterData.storage.rawPath);
                await docRef.update({ 'storage.rawPath': admin.firestore.FieldValue.delete() });
                console.log(`[${episodeId}] ✅ All jobs finished. Original file deleted.`);
            }
        }
        else {
            console.warn(`[${episodeId}] ⚠️ AI job did not complete successfully. Original file at ${afterData.storage.rawPath} was NOT deleted for manual inspection.`);
        }
    }
});
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    const prefix = `episodes/${episodeId}/`;
    try {
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files for episode ${episodeId} deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    const episode = event.data?.data();
    const keyId = episode?.encryption?.keyId;
    if (keyId) {
        try {
            await db.collection('video_keys').doc(keyId).delete();
            console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
        }
        catch (error) {
            console.error(`[DELETE FAILED] Could not delete encryption key ${keyId}.`, error);
        }
    }
});
//# sourceMappingURL=index.js.map