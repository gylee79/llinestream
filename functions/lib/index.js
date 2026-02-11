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
exports.deleteFilesOnEpisodeDelete = exports.analyzeVideoOnWrite = void 0;
exports.runAiAnalysis = runAiAnalysis;
/**
 * @fileoverview Video Analysis & Encryption Pipeline (v6 - fMP4 Segment-based)
 * This version transcodes videos into fragmented MP4, splits them into segments,
 * and encrypts each segment individually for secure, efficient streaming.
 */
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs/promises"));
const crypto = __importStar(require("crypto"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
// Use require for ffprobe-static to avoid TS7016 error
const { path: ffprobePath } = require('ffprobe-static');
// 0. Firebase Admin, FFMpeg, & Global Options 초기화
if (ffmpeg_static_1.default) {
    fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
}
fluent_ffmpeg_1.default.setFfprobePath(ffprobePath);
if (!admin.apps.length) {
    admin.initializeApp();
}
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: ["GOOGLE_GENAI_API_KEY", "KEK_SECRET"],
    timeoutSeconds: 900, // Increased timeout for video processing
    memory: "4GiB", // Increased memory for ffmpeg
    cpu: 2, // Increased CPU for ffmpeg
    minInstances: 0,
    serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();
// --- Utility Functions ---
function getMimeType(filePath) {
    return "video/mp4"; // All outputs are now MP4
}
let genAI = null;
let fileManager = null;
let cachedKEK = null;
function validateKEK(key) {
    if (key.length !== 32) {
        throw new Error(`Invalid KEK format. Expected 32-byte key, received ${key.length} bytes.`);
    }
}
async function loadKEK() {
    if (cachedKEK)
        return cachedKEK;
    const kekSecret = process.env.KEK_SECRET;
    if (!kekSecret)
        throw new Error("CRITICAL: KEK_SECRET is not configured.");
    const key = Buffer.from(kekSecret, 'base64');
    validateKEK(key);
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
// ==========================================
// NEW: Video Processing Pipeline (fMP4)
// ==========================================
async function processAndEncryptVideo(episodeId, inputFilePath, docRef) {
    const tempInputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-in-${episodeId}-`));
    const tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-out-${episodeId}-`));
    const localInputPath = path.join(tempInputDir, 'original_video');
    try {
        // 1. Download source video
        console.log(`[${episodeId}] Downloading source: ${inputFilePath}`);
        await bucket.file(inputFilePath).download({ destination: localInputPath });
        // 2. Transcode to a single fragmented MP4 file first (robust method)
        console.log(`[${episodeId}] Pass 1: Transcoding to fragmented MP4...`);
        const fragmentedMp4Path = path.join(tempInputDir, 'frag.mp4');
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(localInputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                '-profile:v baseline',
                '-level 3.0',
                '-pix_fmt yuv420p',
                '-g 48', // GOP size for 2-second keyframe interval at 24fps
                '-keyint_min 48', // Enforce minimum keyframe interval
                '-sc_threshold 0', // Disable scene change detection for keyframes
                '-movflags frag_keyframe+empty_moov'
            ])
                .toFormat('mp4')
                .on('start', (commandLine) => console.log(`[${episodeId}] 🚀 FFMPEG TRANSCODE COMMAND: ${commandLine}`))
                .on('error', (err) => reject(new Error(`ffmpeg transcoding failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(fragmentedMp4Path);
        });
        console.log(`[${episodeId}] ✅ Pass 1: Transcoding complete.`);
        // 3. Probe the generated fMP4 to get accurate codec info
        console.log(`[${episodeId}] Probing generated fMP4 for codec info...`);
        const probeData = await new Promise((resolve, reject) => {
            fluent_ffmpeg_1.default.ffprobe(fragmentedMp4Path, (err, data) => {
                if (err)
                    return reject(new Error(`ffprobe failed: ${err.message}`));
                resolve(data);
            });
        });
        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;
        if (!videoStream)
            throw new Error("No video stream found in the generated fMP4 file.");
        const codecString = `video/mp4; codecs="${videoStream.codec_tag_string}, ${audioStream?.codec_tag_string || 'mp4a.40.2'}"`;
        console.log(`[${episodeId}] 💡 Detected Codec String: ${codecString}`);
        // 4. Split the fMP4 file into segments
        console.log(`[${episodeId}] Pass 2: Splitting into segments...`);
        const segmentPattern = 'segment_%04d.mp4';
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(fragmentedMp4Path)
                .outputOptions([
                '-c copy',
                '-f segment',
                '-segment_time 4',
                '-reset_timestamps 1'
            ])
                .on('start', (commandLine) => console.log(`[${episodeId}] 🚀 FFMPEG SEGMENT COMMAND: ${commandLine}`))
                .on('error', (err) => reject(new Error(`ffmpeg segmentation failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(path.join(tempOutputDir, segmentPattern));
        });
        console.log(`[${episodeId}] ✅ Pass 2: Segmentation complete.`);
        // 5. Analyze segment files and prepare for encryption
        const createdFiles = await fs.readdir(tempOutputDir);
        console.log(`[${episodeId}] 🔎 Segment file structure analysis:`, createdFiles);
        const initSegmentName = createdFiles.find(f => f.startsWith('segment_'));
        if (!initSegmentName)
            throw new Error("Init segment not found after ffmpeg processing.");
        await fs.rename(path.join(tempOutputDir, initSegmentName), path.join(tempOutputDir, 'init.mp4'));
        console.log(`[${episodeId}] ✅ Renamed ${initSegmentName} to init.mp4.`);
        const mediaSegmentNames = createdFiles.filter(f => f !== initSegmentName).sort();
        const allSegmentsToProcess = ['init.mp4', ...mediaSegmentNames];
        // 6. Encrypt and Upload Segments
        console.log(`[${episodeId}] Encrypting and uploading segments...`);
        const { getKek } = initializeTools();
        const kek = await getKek();
        const masterKey = crypto.randomBytes(32);
        const manifest = {
            codec: codecString,
            init: `episodes/${episodeId}/init.enc`,
            segments: [],
        };
        let totalEncryptedSize = 0;
        for (const [index, fileName] of allSegmentsToProcess.entries()) {
            const localFilePath = path.join(tempOutputDir, fileName);
            const content = await fs.readFile(localFilePath);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            cipher.setAAD(Buffer.from(`fragment-index:${index}`));
            const encryptedContent = Buffer.concat([cipher.update(content), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const finalBuffer = Buffer.concat([iv, encryptedContent, authTag]);
            const outputFileName = fileName.replace('.mp4', '.enc');
            const storagePath = `episodes/${episodeId}/${outputFileName}`;
            await bucket.file(storagePath).save(finalBuffer, { contentType: 'application/octet-stream' });
            console.log(`[${episodeId}] 📦 Segment '${fileName}' | Original Size: ${content.length} bytes -> Encrypted Size: ${finalBuffer.length} bytes`);
            if (fileName !== 'init.mp4') {
                manifest.segments.push({ path: storagePath });
            }
            totalEncryptedSize += finalBuffer.length;
        }
        // 7. Encrypt master key and save to `video_keys`
        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKey = Buffer.concat([kekCipher.update(masterKey), kekCipher.final()]);
        const kekAuthTag = kekCipher.getAuthTag();
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, encryptedMasterKey, kekAuthTag]);
        await db.collection('video_keys').doc(keyId).set({
            keyId,
            videoId: episodeId,
            encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // 8. Upload manifest
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), {
            contentType: 'application/json',
        });
        // 9. Update Firestore document
        await docRef.update({
            duration: Math.round(duration),
            codec: manifest.codec,
            manifestPath: manifestPath,
            keyId: keyId,
            'storage.fileSize': totalEncryptedSize,
            'status.processing': 'completed',
            'status.playable': true,
            'status.error': null,
        });
        console.log(`[${episodeId}] ✅ Processing complete. Manifest created at ${manifestPath}`);
    }
    catch (error) {
        console.error(`[${episodeId}] ❌ Video processing failed:`, error);
        await docRef.update({
            'status.processing': "failed",
            'status.playable': false,
            'status.error': error.message || 'An unknown error occurred during video processing.'
        });
    }
    finally {
        await fs.rm(tempInputDir, { recursive: true, force: true });
        await fs.rm(tempOutputDir, { recursive: true, force: true });
        console.log(`[${episodeId}] Cleaned up temporary files.`);
    }
}
// ==========================================
// Cloud Function Triggers
// ==========================================
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists)
        return;
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    if (afterData.status?.processing !== 'pending' || beforeData?.status?.processing === 'pending') {
        return;
    }
    const { episodeId } = event.params;
    const docRef = change.after.ref;
    console.log(`✨ [${episodeId}] New job detected. Starting video processing and AI analysis...`);
    await docRef.update({
        'status.processing': 'processing',
        aiProcessingStatus: "processing"
    });
    const filePath = afterData.filePath;
    if (!filePath) {
        await docRef.update({
            'status.processing': "failed", 'status.error': "No filePath found.",
            aiProcessingStatus: "failed", aiProcessingError: "No filePath found.",
        });
        return;
    }
    await processAndEncryptVideo(episodeId, filePath, docRef);
    await runAiAnalysis(episodeId, filePath, docRef);
    console.log(`[${episodeId}] Deleting original source file: ${filePath}`);
    await deleteStorageFileByPath(filePath);
    console.log(`✅ [${episodeId}] All jobs finished.`);
});
async function runAiAnalysis(episodeId, filePath, docRef) {
    const modelName = "gemini-3-flash-preview";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-in-${episodeId}`);
    let uploadedFile = null;
    try {
        await bucket.file(filePath).download({ destination: tempFilePath });
        const uploadResponse = await localFileManager.uploadFile(tempFilePath, { mimeType: getMimeType(filePath), displayName: episodeId });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const freshFile = await localFileManager.getFile(uploadedFile.name);
            state = freshFile.state;
            console.log(`... AI processing status: ${state}`);
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI file processing failed.");
        console.log(`[${episodeId}] Calling Gemini model...`);
        const model = localGenAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `Analyze this video. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. Output MUST be a JSON object with keys "summary", "transcript", "timeline". Timeline items must have "startTime", "endTime", "subtitle", "description". ALL OUTPUT MUST BE IN KOREAN.`;
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        const rawText = result.response.text();
        let output;
        try {
            const startIndex = rawText.indexOf('{');
            const endIndex = rawText.lastIndexOf('}');
            if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                throw new Error("AI response does not contain a valid JSON object.");
            }
            const jsonString = rawText.substring(startIndex, endIndex + 1);
            output = JSON.parse(jsonString);
        }
        catch (jsonError) {
            console.error(`[${episodeId}] AI JSON parsing error. Raw output:`, rawText);
            throw new Error(`JSON 파싱 실패: ${jsonError.message}.`);
        }
        const transcriptPath = `episodes/${episodeId}/ai/transcript.txt`;
        await bucket.file(transcriptPath).save(output.transcript || "", { contentType: 'text/plain' });
        let subtitlePath = null;
        if (output.timeline && Array.isArray(output.timeline) && output.timeline.length > 0) {
            const vttContent = `WEBVTT\n\n${output.timeline
                .map((item) => {
                const start = item.startTime || '00:00:00.000';
                const end = item.endTime || '00:00:00.000';
                return `${start} --> ${end}\n${item.subtitle}`;
            })
                .join('\n\n')}`;
            subtitlePath = `episodes/${episodeId}/subtitles/subtitle.vtt`;
            await bucket.file(subtitlePath).save(vttContent, { contentType: 'text/vtt' });
        }
        await docRef.update({
            aiProcessingStatus: "completed",
            aiModel: modelName,
            aiGeneratedContent: JSON.stringify({ summary: output.summary, timeline: output.timeline }),
            transcriptPath: transcriptPath,
            subtitlePath: subtitlePath,
            aiProcessingError: null,
        });
        console.log(`[${episodeId}] ✅ AI analysis succeeded!`);
    }
    catch (error) {
        console.error(`❌ [${episodeId}] AI analysis failed.`, error);
        await docRef.update({
            aiProcessingStatus: "failed",
            aiProcessingError: error.message || String(error),
        });
    }
    finally {
        if (uploadedFile) {
            try {
                await localFileManager.deleteFile(uploadedFile.name);
            }
            catch (e) { }
        }
        try {
            await fs.rm(tempFilePath, { force: true });
        }
        catch (e) { }
    }
}
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    const prefix = `episodes/${episodeId}/`;
    try {
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    try {
        const keyId = event.data?.data()?.keyId || `vidkey_${episodeId}`;
        await db.collection('video_keys').doc(keyId).delete();
        console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete encryption key for episode ${episodeId}.`, error);
    }
});
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
//# sourceMappingURL=index.js.map