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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFilesOnEpisodeDelete = exports.episodeProcessingTrigger = void 0;
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
// 0. SDK Initialization and Global Config
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
let genAI = null;
let fileManager = null;
function initializeTools() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
        throw new Error("GOOGLE_GENAI_API_KEY is not configured.");
    if (!genAI)
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    if (!fileManager)
        fileManager = new server_1.GoogleAIFileManager(apiKey);
    return { genAI, fileManager };
}
async function updateDoc(docRef, data) {
    await docRef.update({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}
async function failPipeline(docRef, step, error, playable = false) {
    const rawError = (error instanceof Error) ? error.message : String(error);
    await docRef.update({
        'status.pipeline': 'failed',
        'status.playable': playable,
        'status.error': { step: step, message: rawError, ts: admin.firestore.FieldValue.serverTimestamp() },
        // Also block AI if the core pipeline fails
        'ai.status': 'blocked',
        'ai.error': { code: 'PIPELINE_FAILED', message: '비디오 처리 파이프라인 실패로 AI 분석이 차단되었습니다.' }
    });
    console.error(`[${docRef.id}] ❌ Pipeline Failed at step '${step}':`, rawError);
}
// 2. Pipeline Stage Implementations
async function runVideoCoreStage(docRef, episode) {
    let currentStep = 'preparing';
    const { id: episodeId, storage: { rawPath } } = episode;
    if (!rawPath)
        throw { step: 'preparing', error: new Error("storage.rawPath is missing.") };
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-${episodeId}-`));
    const localInputPath = path.join(tempDir, 'original_video');
    const fragmentedMp4Path = path.join(tempDir, 'frag.mp4');
    const defaultThumbnailPath = path.join(tempDir, 'default_thumb.jpg');
    try {
        currentStep = 'preparing';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 5 });
        await bucket.file(rawPath).download({ destination: localInputPath });
        currentStep = 'validate';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 10 });
        const probeData = await new Promise((res, rej) => fluent_ffmpeg_1.default.ffprobe(localInputPath, (err, data) => err ? rej(err) : res(data)));
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;
        currentStep = 'transcoding';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 15 });
        await new Promise((resolve, reject) => {
            const command = (0, fluent_ffmpeg_1.default)(localInputPath).videoCodec('libx264').outputOptions(['-vf', 'scale=-2:1080']);
            if (audioStream)
                command.audioCodec('aac');
            command.outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4').on('error', reject).on('end', () => resolve()).save(fragmentedMp4Path);
        });
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(fragmentedMp4Path).outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                .on('error', reject).on('end', () => resolve()).save(path.join(tempDir, 'manifest.mpd'));
        });
        currentStep = 'thumbnail';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 40 });
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(localInputPath).seekInput(duration * 0.5).frames(1).output(defaultThumbnailPath)
                .on('error', reject).on('end', () => resolve()).run();
        });
        currentStep = 'encrypting';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 50 });
        const createdFiles = await fs.readdir(tempDir);
        const segmentNames = ['init.mp4', ...createdFiles.filter(f => f.startsWith('segment_')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
        const kek = Buffer.from(process.env.KEK_SECRET, 'base64');
        const masterKey = crypto.randomBytes(32);
        const encryptedBasePath = `episodes/${episodeId}/segments/`;
        const processedSegments = [];
        for (const fileName of segmentNames) {
            const content = await fs.readFile(path.join(tempDir, fileName));
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            const storagePath = `${encryptedBasePath}${fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc')}`;
            cipher.setAAD(Buffer.from(`path:${storagePath}`));
            const finalBuffer = Buffer.concat([iv, cipher.update(content), cipher.final(), cipher.getAuthTag()]);
            await bucket.file(storagePath).save(finalBuffer);
            processedSegments.push({ name: fileName, path: storagePath });
        }
        currentStep = 'manifest';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 85 });
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        const manifest = {
            codec: audioStream ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` : `video/mp4; codecs="avc1.42E01E"`,
            duration: Math.round(duration),
            init: processedSegments.find(s => s.name === 'init.mp4')?.path,
            segments: processedSegments.filter(s => s.name !== 'init.mp4').map(s => ({ path: s.path })),
        };
        currentStep = 'uploading';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 90 });
        await bucket.file(manifestPath).save(JSON.stringify(manifest));
        const defaultThumbStoragePath = `episodes/${episodeId}/thumbnails/default.jpg`;
        await bucket.upload(defaultThumbnailPath, { destination: defaultThumbStoragePath });
        const defaultThumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(defaultThumbStoragePath)}?alt=media`;
        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, kekCipher.update(masterKey), kekCipher.final(), kekCipher.getAuthTag()]);
        await db.collection('video_keys').doc(keyId).set({ encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'), kekVersion: 1 });
        const encryptionInfo = { algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, keyId, kekVersion: 1, aadMode: "path", segmentDurationSec: 4, fragmentEncrypted: true };
        await updateDoc(docRef, {
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath, 'storage.manifestPath': manifestPath,
            'thumbnails.default': defaultThumbUrl, 'thumbnails.defaultPath': defaultThumbStoragePath,
            'thumbnailUrl': episode.thumbnails.custom || defaultThumbUrl,
            'encryption': encryptionInfo,
            'status.pipeline': 'completed', 'status.playable': true, 'status.step': 'done', 'status.progress': 100, 'status.error': null,
            'ai.status': 'queued',
        });
    }
    catch (e) {
        await failPipeline(docRef, currentStep, e.error || e, false);
    }
    finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
async function runAiStage(docRef, episode) {
    const { id: episodeId, storage: { rawPath } } = episode;
    if (!rawPath)
        throw new Error("AI analysis requires rawPath, but it was missing.");
    initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile = null;
    try {
        await updateDoc(docRef, { 'ai.status': 'processing', 'ai.model': 'gemini-2.5-flash' });
        await bucket.file(rawPath).download({ destination: tempFilePath });
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4' });
        uploadedFile = uploadResponse.file;
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const freshFile = await fileManager.getFile(uploadedFile.name);
            state = freshFile.state;
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI file processing failed.");
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" },
            safetySettings: [{ category: generative_ai_1.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: generative_ai_1.HarmBlockThreshold.BLOCK_NONE }]
        });
        const prompt = "상세 요약(summary), 타임라인(timeline), 전체 대본(transcript) 뿐만 아니라, AI 검색/채팅을 위한 핵심 키워드(keywords)와 주제(topics)를 JSON으로 추출할 것. 모든 결과는 한국어로 작성되어야 합니다.";
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        const output = JSON.parse(result.response.text());
        const searchDataPath = `episodes/${episodeId}/ai/search_data.json`;
        await bucket.file(searchDataPath).save(JSON.stringify(output));
        await updateDoc(docRef, { 'ai.status': 'completed', 'ai.resultPaths': { search_data: searchDataPath }, 'ai.error': null });
    }
    catch (e) {
        console.error(`[${episodeId}] ❌ AI Stage Failed.`, e);
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { code: 'AI_PROCESSING_FAILED', message: e.message || 'Unknown AI error' }
        });
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
async function runCleanupStage(docRef, episode) {
    if (episode.storage.rawPath) {
        await bucket.file(episode.storage.rawPath).delete().catch(e => console.error(`Failed to delete rawPath ${episode.storage.rawPath}`, e));
        await updateDoc(docRef, { 'storage.rawPath': admin.firestore.FieldValue.delete() });
    }
}
// 3. Main Orchestrator Trigger
exports.episodeProcessingTrigger = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    if (!event.data)
        return; // No data, no-op
    const before = event.data.before.data();
    const after = event.data.after.data();
    // Loop Prevention Guard: Exit if status fields haven't changed.
    if (before && after.status?.pipeline === before.status?.pipeline && after.ai?.status === before.ai?.status) {
        return;
    }
    const docRef = event.data.after.ref;
    try {
        // Stage 0: Validation & Stage 1: Video Core
        if (after.status.pipeline === 'pending') {
            await updateDoc(docRef, { 'status.pipeline': 'processing', 'status.step': 'preparing', 'status.progress': 5, 'status.playable': false, 'status.error': null });
            if (!after.storage?.rawPath || !(await bucket.file(after.storage.rawPath).exists())[0]) {
                throw { step: 'validate', error: new Error("RawPath Missing or file does not exist.") };
            }
            await runVideoCoreStage(docRef, after);
        }
        // Stage 2: AI Intelligence
        else if (after.ai?.status === 'queued' && before?.ai?.status !== 'queued') {
            await runAiStage(docRef, after);
        }
        // Stage 3: Cleanup
        else if (before && (after.ai?.status === 'completed' || after.ai?.status === 'failed') && after.ai?.status !== before.ai?.status) {
            await runCleanupStage(docRef, after);
        }
    }
    catch (e) {
        await failPipeline(docRef, e.step || 'trigger-exception', e.error || e, after.status.playable);
    }
});
// 4. Deletion Trigger
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const prefix = `episodes/${event.params.episodeId}/`;
    await bucket.deleteFiles({ prefix }).catch(e => console.error(`Failed to delete files for episode ${event.params.episodeId}`, e));
    const keyId = event.data?.data().encryption?.keyId;
    if (keyId) {
        await db.collection('video_keys').doc(keyId).delete().catch(e => console.error(`Failed to delete key ${keyId}`, e));
    }
});
//# sourceMappingURL=index.js.map