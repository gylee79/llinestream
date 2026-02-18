/**
 * @fileoverview LlineStream Video Processing Pipeline v7.0 (Multi-Trigger State Machine)
 *
 * Implements a highly decoupled, state-machine-driven workflow using multiple
 * independent Cloud Functions. Each function represents a distinct stage of the
 * pipeline, triggered by status changes in the Firestore document. This architecture
 * provides maximum visibility, prevents timeouts, and improves reliability.
 */

// --- Firebase and Node.js Imports ---
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as crypto from "crypto";

// --- AI and Media Processing Imports ---
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
const { path: ffprobePath } = require('ffprobe-static');

// --- Type Definitions ---
import type { Episode, PipelineStatus } from './lib/types';


// 0. Initialize SDKs and Global Configuration
// ===============================================

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}
ffmpeg.setFfprobePath(ffprobePath);

if (admin.apps.length === 0) {
  admin.initializeApp();
}

setGlobalOptions({
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

let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;
let cachedKEK: Buffer | null = null;

async function loadKEK(): Promise<Buffer> {
    if (cachedKEK) return cachedKEK;
    const kekSecret = process.env.KEK_SECRET;
    if (!kekSecret) throw new Error("CRITICAL: KEK_SECRET is not configured.");
    const key = Buffer.from(kekSecret, 'base64');
    if (key.length !== 32) throw new Error(`Invalid KEK format. Expected 32-byte key, received ${key.length} bytes.`);
    cachedKEK = key;
    return cachedKEK;
}

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");
  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager, getKek: loadKEK };
}

async function updateStatus(docRef: admin.firestore.DocumentReference, status: Partial<PipelineStatus>) {
    const updatePayload: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(status)) {
        updatePayload[`status.${key}`] = value;
    }
    updatePayload['status.updatedAt'] = admin.firestore.FieldValue.serverTimestamp();
    updatePayload['status.lastHeartbeatAt'] = admin.firestore.FieldValue.serverTimestamp();
    await docRef.update(updatePayload);
}

async function failPipeline(docRef: admin.firestore.DocumentReference, step: PipelineStatus['step'], error: any, hint?: string) {
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

const deleteStoragePath = async (pathToDelete: string | undefined) => {
    if (!pathToDelete) return;
    try {
        await bucket.deleteFiles({ prefix: pathToDelete });
        console.log(`[CLEANUP] Deleted temporary path: ${pathToDelete}`);
    } catch (error) {
        console.error(`[CLEANUP_FAILED] Could not delete temporary path ${pathToDelete}.`, error);
    }
};


// 2. Pipeline Stage Implementations
// ===================================

/** STAGE 1: Validates video file format and metadata. */
async function runVideoValidation(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    const localPath = path.join(os.tmpdir(), `validate-${episodeId}`);
    try {
        await updateStatus(docRef, { step: 'validating', progress: 5 });
        await bucket.file(episodeData.storage.rawPath).download({ destination: localPath });
        
        const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(localPath, (err, data) => err ? reject(err) : resolve(data));
        });
        
        if (!probeData.streams.find(s => s.codec_type === 'video')) {
            throw new Error("No video stream found in the uploaded file.");
        }
        
        await docRef.update({ duration: Math.round(probeData.format.duration || 0) });
        await updateStatus(docRef, { step: 'transcoding_pending', progress: 10 });
        console.log(`[${episodeId}] ✅ Validation complete.`);
        
    } catch(e: any) {
        await failPipeline(docRef, 'validating', e, '비디오 파일 유효성 검사에 실패했습니다.');
    } finally {
        await fs.rm(localPath, { force: true, recursive: true }).catch(() => {});
    }
}

/** STAGE 2: Transcodes video to fragmented MP4 and segments it. */
async function runVideoTranscoding(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    const tempInputDir = await fs.mkdtemp(path.join(os.tmpdir(), `in-${episodeId}-`));
    const tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), `out-${episodeId}-`));
    const localInputPath = path.join(tempInputDir, 'original_video');
    const tempUnencryptedPath = `episodes/${episodeId}/temp_unencrypted/`;

    try {
        await updateStatus(docRef, { step: 'transcoding', progress: 15 });
        await bucket.file(episodeData.storage.rawPath).download({ destination: localInputPath });
        
        const audioStream = (await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(localInputPath, (err, data) => err ? reject(err) : resolve(data));
        })).streams.find(s => s.codec_type === 'audio');

        const fragmentedMp4Path = path.join(tempInputDir, 'frag.mp4');
        await new Promise<void>((resolve, reject) => {
            const command = ffmpeg(localInputPath).videoCodec('libx264');
            if (audioStream) command.audioCodec('aac');
            command
                .outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4')
                .on('error', (err) => reject(err)).on('end', () => resolve())
                .save(fragmentedMp4Path);
        });

        await new Promise<void>((resolve, reject) => {
            ffmpeg(fragmentedMp4Path)
                .outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                .on('error', (err) => reject(err)).on('end', () => resolve())
                .save(path.join(tempOutputDir, 'manifest.mpd'));
        });

        const filesToUpload = await fs.readdir(tempOutputDir);
        for (const file of filesToUpload) {
            if (file.endsWith('.mp4') || file.endsWith('.m4s')) {
                await bucket.upload(path.join(tempOutputDir, file), { destination: `${tempUnencryptedPath}${file}` });
            }
        }
        
        await docRef.update({ 'storage.tempUnencryptedPath': tempUnencryptedPath });
        await updateStatus(docRef, { step: 'encryption_pending', progress: 40 });
        console.log(`[${episodeId}] ✅ Transcoding complete.`);
        
    } catch(e: any) {
        await failPipeline(docRef, 'transcoding', e, '비디오 변환 또는 분할에 실패했습니다.');
    } finally {
        await fs.rm(tempInputDir, { recursive: true, force: true }).catch(() => {});
        await fs.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
    }
}

/** STAGE 3: Encrypts the unencrypted segments. */
async function runSegmentEncryption(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `enc-${episodeId}-`));
    const tempUnencryptedPath = episodeData.storage.tempUnencryptedPath;
    
    if (!tempUnencryptedPath) {
        await failPipeline(docRef, 'encrypting', new Error('Temporary unencrypted path is missing.'), '암호화 단계에서 원본 세그먼트 경로를 찾지 못했습니다.');
        return;
    }

    try {
        await updateStatus(docRef, { step: 'encrypting', progress: 45 });
        const [files] = await bucket.getFiles({ prefix: tempUnencryptedPath });

        const masterKey = crypto.randomBytes(32);
        const encryptedBasePath = episodeData.storage.encryptedBasePath;
        
        for (const file of files) {
            const fileName = path.basename(file.name);
            const localPath = path.join(tempDir, fileName);
            await file.download({ destination: localPath });
            
            const content = await fs.readFile(localPath);
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
        }
        
        // Temporarily store the raw key in Firestore for the next step.
        // This is acceptable as it's an intermediate step and will be deleted.
        await docRef.update({ 'tempMasterKey': masterKey.toString('base64') });
        await updateStatus(docRef, { step: 'finalization_pending', progress: 85 });
        console.log(`[${episodeId}] ✅ Encryption complete.`);

    } catch(e: any) {
        await failPipeline(docRef, 'encrypting', e, '세그먼트 암호화에 실패했습니다.');
    } finally {
        await deleteStoragePath(tempUnencryptedPath);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

/** STAGE 4: Creates the manifest, encrypts the key, and finalizes the pipeline. */
async function runFinalization(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    // @ts-ignore
    const tempMasterKey = episodeData.tempMasterKey;
    if (!tempMasterKey) {
        await failPipeline(docRef, 'finalizing', new Error('Master key is missing.'), '키 암호화 단계에서 마스터 키를 찾지 못했습니다.');
        return;
    }
    const masterKey = Buffer.from(tempMasterKey, 'base64');
    
    try {
        await updateStatus(docRef, { step: 'finalizing', progress: 90 });

        const [files] = await bucket.getFiles({ prefix: episodeData.storage.encryptedBasePath });
        const manifest = {
            codec: `video/mp4; codecs="avc1.42E01E, mp4a.40.2"`, // Assuming standard codec for now
            duration: episodeData.duration,
            init: files.find(f => f.name.endsWith('init.enc'))?.name,
            segments: files.filter(f => f.name.includes('segment_')).sort().map(f => ({ path: f.name }))
        };
        await bucket.file(episodeData.storage.manifestPath).save(JSON.stringify(manifest), { contentType: 'application/json' });
        
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
            kekVersion: 1, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        await docRef.update({
            'encryption.keyId': keyId,
            'tempMasterKey': admin.firestore.FieldValue.delete(), // Securely delete temp key
        });

        await updateStatus(docRef, { pipeline: 'completed', step: 'done', progress: 100, playable: true });
        await docRef.update({ 'ai.status': 'queued' }); // Queue AI analysis
        console.log(`[${episodeId}] ✅ Finalization complete. Video is playable.`);

    } catch(e: any) {
        await failPipeline(docRef, 'finalizing', e, '매니페스트 또는 키 생성에 실패했습니다.');
    }
}

/** STAGE 5: Runs AI analysis on the video. */
export async function runAiAnalysis(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    const modelName = "gemini-2.5-flash";
    if (episodeData.status.pipeline !== 'completed' || !episodeData.storage.rawPath) {
        await docRef.update({ 'ai.status': 'blocked', 'ai.error': { message: 'Video pipeline did not complete successfully or rawPath is missing.' } });
        return;
    }
    
    await docRef.update({ 'ai.status': 'processing', 'ai.model': modelName });
    const { genAI, fileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile: any = null;

    try {
        await bucket.file(episodeData.storage.rawPath).download({ destination: tempFilePath });
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4', displayName: episodeId });
        uploadedFile = uploadResponse.file;

        let state = uploadedFile.state;
        while (state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            state = (await fileManager.getFile(uploadedFile.name)).state;
        }

        if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");
        
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" }}); 
        const prompt = `Analyze this video. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. Output MUST be a JSON object with keys "summary", "transcript", "timeline". Timeline items must have "startTime", "endTime", "subtitle", "description". ALL OUTPUT MUST BE IN KOREAN.`;
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        
        const rawText = result.response.text();
        const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
        const output = JSON.parse(jsonString);
        
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

    } catch (error: any) {
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { message: error.message || String(error) }
        });
        console.error(`❌ [${episodeId}] AI analysis failed.`, error);
    } finally {
        if (uploadedFile) { try { await fileManager.deleteFile(uploadedFile.name); } catch (e) {} }
        try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
    }
}

/** STAGE 6: Deletes the original raw video file. */
async function runCleanup(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode) {
    if (episodeData.storage.rawPath) {
        await deleteStoragePath(episodeData.storage.rawPath);
        await docRef.update({ 'storage.rawPath': admin.firestore.FieldValue.delete() });
        console.log(`[${episodeId}] ✅ Cleanup complete. Original file deleted.`);
    }
}

// 3. Cloud Function Triggers (State Machine)
// ============================================

const wasStatusChanged = (before: Episode, after: Episode, field: 'pipeline' | 'step' | `ai.${'status'}`): boolean => {
    const beforeStatus = field === 'pipeline' ? before.status?.pipeline : field === 'step' ? before.status?.step : before.ai?.status;
    const afterStatus = field === 'pipeline' ? after.status?.pipeline : field === 'step' ? after.status?.step : after.ai?.status;
    return beforeStatus !== afterStatus;
};

/** Trigger for STAGE 1: Validation */
export const validationTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists) return;
    const after = change.after.data() as Episode;
    
    if (after.status?.pipeline === 'pending' && wasStatusChanged(change.before.data() as Episode, after, 'pipeline')) {
        console.log(`[TRIGGER] Stage 1: Validation for ${event.params.episodeId}`);
        await runVideoValidation(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for STAGE 2: Transcoding */
export const transcodingTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;
    const after = change.after.data() as Episode;
    
    if (after.status?.step === 'transcoding_pending' && wasStatusChanged(change.before.data() as Episode, after, 'step')) {
        console.log(`[TRIGGER] Stage 2: Transcoding for ${event.params.episodeId}`);
        await runVideoTranscoding(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for STAGE 3: Encryption */
export const encryptionTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;
    const after = change.after.data() as Episode;
    
    if (after.status?.step === 'encryption_pending' && wasStatusChanged(change.before.data() as Episode, after, 'step')) {
        console.log(`[TRIGGER] Stage 3: Encryption for ${event.params.episodeId}`);
        await runSegmentEncryption(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for STAGE 4: Finalization (Manifest & Keys) */
export const finalizationTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;
    const after = change.after.data() as Episode;
    
    if (after.status?.step === 'finalization_pending' && wasStatusChanged(change.before.data() as Episode, after, 'step')) {
        console.log(`[TRIGGER] Stage 4: Finalization for ${event.params.episodeId}`);
        await runFinalization(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for STAGE 5: AI Analysis */
export const aiAnalysisTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;
    const after = change.after.data() as Episode;

    if (after.ai?.status === 'queued' && wasStatusChanged(change.before.data() as Episode, after, 'ai.status')) {
        console.log(`[TRIGGER] Stage 5: AI Analysis for ${event.params.episodeId}`);
        await runAiAnalysis(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for STAGE 6: Cleanup */
export const cleanupTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;
    const after = change.after.data() as Episode;

    if (after.ai?.status === 'completed' && wasStatusChanged(change.before.data() as Episode, after, 'ai.status')) {
        console.log(`[TRIGGER] Stage 6: Cleanup for ${event.params.episodeId}`);
        await runCleanup(event.params.episodeId, change.after.ref, after);
    }
});

/** Trigger for Deleting all associated files when an episode document is deleted. */
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const episode = event.data?.data() as Episode;
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    
    // Delete all files in the episode's main storage folder
    const prefix = `episodes/${episodeId}/`;
    await deleteStoragePath(prefix);
    
    // Delete the encryption key
    const keyId = episode?.encryption?.keyId;
    if (keyId) {
        try {
            await db.collection('video_keys').doc(keyId).delete();
            console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
        } catch (error) {
            console.error(`[DELETE FAILED] Could not delete encryption key ${keyId}.`, error);
        }
    }
});
