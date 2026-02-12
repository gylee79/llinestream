

/**
 * @fileoverview LlineStream Video Processing Pipeline Spec v1 Implementation
 * Implements the deterministic, fail-fast video processing and AI analysis workflow.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
// Use require for ffprobe-static to avoid TS7016 error
const { path: ffprobePath } = require('ffprobe-static');
import type { Episode, PipelineStatus } from '../../src/lib/types';


// 0. Initialize SDKs and Constants
// ===================================
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}
ffmpeg.setFfprobePath(ffprobePath);

if (!admin.apps.length) {
  admin.initializeApp();
}

// From Spec 3: Set global options
setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY", "KEK_SECRET"],
  timeoutSeconds: 540, // 9 minutes, max allowed
  memory: "4GiB",
  cpu: 2,
  minInstances: 0,
  serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// From Spec 3
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
    const key = Buffer.from(kekSecret, 'base64'); // From Spec 3
    if (key.length !== 32) {
        throw new Error(`Invalid KEK format. Expected 32-byte key, received ${key.length} bytes.`);
    }
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

async function updatePipelineStatus(docRef: admin.firestore.DocumentReference, status: Partial<PipelineStatus>) {
    await docRef.update({
        'status.pipeline': status.pipeline,
        'status.step': status.step,
        'status.progress': status.progress,
        'status.playable': status.playable,
        'status.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        'status.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp(),
    });
}

async function failPipeline(docRef: admin.firestore.DocumentReference, step: PipelineStatus['step'], error: any, hint?: string) {
    const rawError = (error instanceof Error) ? error.message : String(error);
    await docRef.update({
        'status.pipeline': 'failed',
        'status.step': step,
        'status.playable': false,
        'status.progress': 100, // Mark as finished, but failed
        'status.error': {
            step: step,
            code: error.code || 'UNKNOWN',
            message: rawError,
            hint: hint || '해당 단계에서 처리 중 오류가 발생했습니다.',
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
            ts: admin.firestore.FieldValue.serverTimestamp()
        },
        'ai.status': 'blocked', // From Spec 9: Block AI if pipeline fails
        'ai.error': {
            code: 'PIPELINE_FAILED',
            message: '비디오 처리 파이프라인이 실패하여 AI 분석을 건너뜁니다.',
            ts: admin.firestore.FieldValue.serverTimestamp()
        }
    });
    console.error(`[${docRef.id}] ❌ Pipeline Failed at step '${step}':`, rawError);
}


// 2. Video Processing Pipeline (State Machine)
// ===============================================

async function processAndEncryptVideo(episodeId: string, inputFilePath: string, docRef: admin.firestore.DocumentReference): Promise<boolean> {
    const tempInputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-in-${episodeId}-`));
    const tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-out-${episodeId}-`));
    const localInputPath = path.join(tempInputDir, 'original_video');

    try {
        // STEP 0: Download and Prepare
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'validate', progress: 5, playable: false });
        await bucket.file(inputFilePath).download({ destination: localInputPath });

        // STEP 1: Validate (ffprobe) - Spec 6.1
        const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(localInputPath, (err, data) => err ? reject(err) : resolve(data));
        }).catch(err => { throw { step: 'validate', error: err }; });
        
        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        if (!videoStream) throw { step: 'validate', error: new Error("No video stream found.") };
        const duration = probeData.format.duration || 0;
        const codecString = `video/mp4; codecs="${videoStream.codec_tag_string}, ${audioStream?.codec_tag_string || 'mp4a.40.2'}"`;

        // STEP 2: FFMPEG (Transcode & Segment) - Spec 6.2
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'ffmpeg', progress: 15, playable: false });
        const fragmentedMp4Path = path.join(tempInputDir, 'frag.mp4');

        await new Promise<void>((resolve, reject) => {
            const command = ffmpeg(localInputPath).videoCodec('libx264');
            // Only add audio codec if an audio stream exists
            if (audioStream) {
                command.audioCodec('aac');
            }
            command
                .outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4')
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(fragmentedMp4Path);
        }).catch(err => { throw { step: 'ffmpeg', error: err, hint: "Video transcoding failed." }; });


        await new Promise<void>((resolve, reject) => {
            ffmpeg(fragmentedMp4Path)
                .outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(path.join(tempOutputDir, 'manifest.mpd')); // mpd is ignored
        }).catch(err => { throw { step: 'ffmpeg', error: err, hint: "DASH segmentation failed." }; });

        // STEP 3: Encrypt - Spec 6.3
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'encrypt', progress: 40, playable: false });
        const createdFiles = await fs.readdir(tempOutputDir);
        if (!createdFiles.includes("init.mp4")) throw { step: 'encrypt', error: new Error("init.mp4 not found after segmentation.") };
        const mediaSegmentNames = createdFiles.filter(f => f.startsWith('segment_') && f.endsWith('.m4s')).sort((a, b) => parseInt(a.match(/(\\d+)/)?.[0] || '0') - parseInt(b.match(/(\\d+)/)?.[0] || '0'));
        const allSegmentsToProcess = ['init.mp4', ...mediaSegmentNames];
        
        const { getKek } = initializeTools();
        const masterKey = crypto.randomBytes(32); // Spec 6.6
        const salt = crypto.randomBytes(16); // Generate a persistent salt for this video
        const encryptedBasePath = `episodes/${episodeId}/segments/`;

        for (const fileName of allSegmentsToProcess) {
            const localFilePath = path.join(tempOutputDir, fileName);
            const content = await fs.readFile(localFilePath);
            const iv = crypto.randomBytes(12); // Spec 3
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            const outputFileName = fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc');
            const storagePath = `${encryptedBasePath}${outputFileName}`;
            const aad = Buffer.from(`path:${storagePath}`); // Spec 3
            cipher.setAAD(aad);
            const encryptedContent = Buffer.concat([cipher.update(content), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const finalBuffer = Buffer.concat([iv, encryptedContent, authTag]); // Spec 3
            await bucket.file(storagePath).save(finalBuffer, { contentType: 'application/octet-stream' });
        }

        // STEP 5: Manifest - Spec 6.5 (Verify is done after this for simplicity)
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'manifest', progress: 85, playable: false });
        const manifest = {
            codec: codecString,
            duration: Math.round(duration),
            init: `${encryptedBasePath}init.enc`,
            segments: mediaSegmentNames.map(name => ({ path: `${encryptedBasePath}${name.replace('.m4s', '.m4s.enc')}` })),
        };
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), { contentType: 'application/json' });

        // STEP 6: Keys - Spec 6.6
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'keys', progress: 95, playable: false });
        const kek = await getKek();
        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKey = Buffer.concat([kekCipher.update(masterKey), kekCipher.final()]);
        const kekAuthTag = kekCipher.getAuthTag();
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, encryptedMasterKey, kekAuthTag]);
        await db.collection('video_keys').doc(keyId).set({
            keyId, videoId: episodeId,
            encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'),
            salt: salt.toString('base64'), // Store the salt
            kekVersion: 1, // Spec 6.6
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        // STEP 7: Completion - Spec 6.7
        await docRef.update({
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath,
            'storage.manifestPath': manifestPath,
            'encryption': { // Spec 4.3
                algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16,
                keyId: keyId, kekVersion: 1, aadMode: "path",
                segmentDurationSec: SEGMENT_DURATION_SEC, fragmentEncrypted: true
            },
            'status.pipeline': 'completed', 'status.step': 'done',
            'status.progress': 100, 'status.playable': true, 'status.error': null,
            'status.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
            'status.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp(),
            'ai.status': 'queued', // Queue AI analysis
        });
        
        console.log(`[${episodeId}] ✅ Video Pipeline complete.`);
        return true;

    } catch (error: any) {
        await failPipeline(docRef, error.step || 'unknown', error.error || error, error.hint);
        return false;
    } finally {
        await fs.rm(tempInputDir, { recursive: true, force: true });
        await fs.rm(tempOutputDir, { recursive: true, force: true });
    }
}


// 3. AI Analysis Pipeline
// ===============================================
export async function runAiAnalysis(episodeId: string, docRef: admin.firestore.DocumentReference, episodeData: Episode): Promise<boolean> {
    const modelName = "gemini-3-flash-preview"; // From SYSTEM_RULES.md
    
    // --- SAFETY CHECK: Entire function wrapped in a try...catch block ---
    try {
        console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
        
        // From Spec 9: AI Analyzer Guard Conditions
        if (episodeData.status.pipeline !== 'completed' || !episodeData.status.playable || !episodeData.storage.rawPath) {
            await docRef.update({ 'ai.status': 'blocked', 'ai.error': { code: 'AI_GUARD_BLOCKED', message: 'Video pipeline did not complete successfully or rawPath is missing.', ts: admin.firestore.FieldValue.serverTimestamp() } });
            console.warn(`[${episodeId}] ⚠️ AI analysis blocked. Pipeline status: ${episodeData.status.pipeline}, Playable: ${episodeData.status.playable}`);
            return false;
        }
        await docRef.update({ 'ai.status': 'processing', 'ai.model': modelName, 'ai.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp() });
        
        const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
        const tempFilePath = path.join(os.tmpdir(), `ai-in-${episodeId}`);
        let uploadedFile: any = null;

        try {
            await bucket.file(episodeData.storage.rawPath).download({ destination: tempFilePath });
            const uploadResponse = await localFileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4', displayName: episodeId });
            uploadedFile = uploadResponse.file;

            let state = uploadedFile.state;
            while (state === FileState.PROCESSING) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await docRef.update({ 'ai.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp() });
                const freshFile = await localFileManager.getFile(uploadedFile.name);
                state = freshFile.state;
            }

            if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");
            
            const model = localGenAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" }}); 
            const prompt = `Analyze this video. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. Output MUST be a JSON object with keys "summary", "transcript", "timeline". Timeline items must have "startTime", "endTime", "subtitle", "description". ALL OUTPUT MUST BE IN KOREAN.`;
            const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
            
            const rawText = result.response.text();
            let output;
            
            try {
                const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
                output = JSON.parse(jsonString);
            } catch (jsonError: any) { throw new Error(`AI response JSON parsing failed: ${jsonError.message}.`); }
            
            const transcriptPath = `episodes/${episodeId}/ai/transcript.txt`;
            await bucket.file(transcriptPath).save(output.transcript || "", { contentType: 'text/plain' });

            await docRef.update({
                'ai.status': 'completed',
                'ai.resultPaths': { transcript: transcriptPath },
                'ai.lastHeartbeatAt': admin.firestore.FieldValue.serverTimestamp(),
                'ai.error': null,
            });

            console.log(`[${episodeId}] ✅ AI analysis succeeded!`);
            return true;

        } catch (error: any) {
            await docRef.update({
                'ai.status': 'failed',
                'ai.error': { code: 'AI_PROCESSING_FAILED', message: error.message || String(error), raw: JSON.stringify(error, Object.getOwnPropertyNames(error)), ts: admin.firestore.FieldValue.serverTimestamp() }
            });
            console.error(`❌ [${episodeId}] AI analysis failed.`, error);
            return false;
        } finally {
            if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
            try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
        }

    } catch (e: any) {
        console.error(`[${episodeId}] UNHANDLED EXCEPTION in runAiAnalysis:`, e);
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { code: 'UNHANDLED_EXCEPTION', message: e.message || "An unknown error occurred during AI analysis startup.", raw: JSON.stringify(e, Object.getOwnPropertyNames(e)), ts: admin.firestore.FieldValue.serverTimestamp() }
        });
        return false;
    }
}


// 4. Cloud Function Triggers
// ===============================================

export const videoPipelineTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const change = event.data;
    if (!change) {
        console.log(`[${episodeId}] No data change. Skipping processing.`);
        return;
    }
    
    // Make sure the document was created, not deleted
    if (!change.after.exists) {
        console.log(`[${episodeId}] Document deleted. Skipping processing.`);
        return;
    }
    
    const docRef = change.after.ref;
    const afterData = change.after.data() as Episode;
    const beforeData = change.before.exists ? change.before.data() as Episode : null;

    // --- DIAGNOSTIC LOGGING AND PRE-CHECKS ---
    console.log(`[${episodeId}] TRIGGERED: onDocumentWritten event received.`);
    try {
        const hasKek = !!process.env.KEK_SECRET;
        const hasGenAiKey = !!process.env.GOOGLE_GENAI_API_KEY;
        console.log(`[${episodeId}] DIAGNOSTIC - KEK_SECRET loaded: ${hasKek}, GOOGLE_GENAI_API_KEY loaded: ${hasGenAiKey}`);

        if (!hasKek || !hasGenAiKey) {
            throw new Error(`Required secrets are missing. KEK: ${hasKek}, GenAI Key: ${hasGenAiKey}. Function cannot start.`);
        }
        
        // --- Video Processing Trigger ---
        // CRITICAL FIX: Only trigger if the pipeline status is newly set to 'queued'.
        if (afterData.status?.pipeline === 'queued' && beforeData?.status?.pipeline !== 'queued') {
            console.log(`✨ [${episodeId}] New video pipeline job detected. Starting process...`);
            
            const success = await processAndEncryptVideo(episodeId, afterData.storage.rawPath, docRef);
            
            if (success) {
                // Fetch the latest data before running AI analysis
                const updatedDoc = await docRef.get();
                const updatedData = updatedDoc.data() as Episode;
                await runAiAnalysis(episodeId, docRef, updatedData);
            }
            
            const finalDoc = await docRef.get();
            const finalData = finalDoc.data() as Episode;
            if (finalData.status.pipeline === 'completed' && (finalData.ai.status === 'completed' || finalData.ai.status === 'blocked')) {
                if (finalData.storage.rawPath) {
                    await deleteStorageFileByPath(finalData.storage.rawPath);
                    console.log(`[${episodeId}] ✅ All jobs finished. Original file deleted.`);
                }
            } else {
                console.warn(`[${episodeId}] ⚠️ Pipeline finished with errors. Original file at ${finalData.storage.rawPath} was NOT deleted for manual inspection.`);
            }
        }
    } catch (e: any) {
        console.error(`[${episodeId}] UNHANDLED EXCEPTION in videoPipelineTrigger:`, e);
        await failPipeline(docRef, 'trigger-exception', e, '함수 트리거 레벨에서 예상치 못한 오류가 발생했습니다.');
    }
});


export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const episode = event.data?.data() as Episode;
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    
    // Delete all files in the episode's storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    
    // Delete the encryption key if it exists
    const keyId = episode?.encryption?.keyId;
    if (keyId) {
        try {
            await db.collection('video_keys').doc(keyId).delete();
            console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
        } catch (error) {
            console.error(`[DELETE FAILED] Could not delete encryption key ${keyId} for episode ${episodeId}.`, error);
        }
    }
});

const deleteStorageFileByPath = async (filePath: string | undefined) => {
    if (!filePath) return;
    try {
        const file = bucket.file(filePath);
        if ((await file.exists())[0]) {
            await file.delete();
        }
    } catch (error) {
        console.error(`Could not delete storage file at path ${filePath}.`, error);
    }
};

