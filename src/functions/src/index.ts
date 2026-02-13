
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
import type { Episode, PipelineStatus } from '../lib/types';


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
        
        // Construct codec string reliably
        const videoCodec = 'avc1.42E01E'; // H.264 Baseline Profile Level 3.0
        const audioCodec = 'mp4a.40.2';   // AAC
        const codecString = audioStream
            ? `video/mp4; codecs="${videoCodec}, ${audioCodec}"`
            : `video/mp4; codecs="${videoCodec}"`;

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
        const encryptedBasePath = `episodes/${episodeId}/segments/`;
        
        const processedSegmentPaths: { name: string, path: string }[] = [];

        for (const fileName of allSegmentsToProcess) {
            const localFilePath = path.join(tempOutputDir, fileName);
            const content = await fs.readFile(localFilePath);
            const iv = crypto.randomBytes(12); // Spec 3
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            const outputFileName = fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc');
            
            // This is the single source of truth for the storage path
            const storagePath = `${encryptedBasePath}${outputFileName}`;
            
            const aad = Buffer.from(`path:${storagePath}`); // Spec 3
            cipher.setAAD(aad);
            const encryptedContent = Buffer.concat([cipher.update(content), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const finalBuffer = Buffer.concat([iv, encryptedContent, authTag]); // Spec 3
            await bucket.file(storagePath).save(finalBuffer, { contentType: 'application/octet-stream' });
            
            // Store the exact path used for AAD to build the manifest later
            processedSegmentPaths.push({ name: fileName, path: storagePath });
        }

        // STEP 5: Manifest - Spec 6.5
        await updatePipelineStatus(docRef, { pipeline: 'processing', step: 'manifest', progress: 85, playable: false });
        
        const initSegment = processedSegmentPaths.find(s => s.name === 'init.mp4');
        if (!initSegment) {
            throw { step: 'manifest', error: new Error("Manifest creation failed: init segment path not found after processing.") };
        }
        
        const manifest = {
            codec: codecString,
            duration: Math.round(duration),
            init: initSegment.path,
            segments: processedSegmentPaths
                .filter(s => s.name !== 'init.mp4')
                .map(s => ({ path: s.path })),
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
    const modelName = "gemini-2.5-flash"; // From SYSTEM_RULES.md
    
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

/**
 * Triggers the video encoding and encryption pipeline when an episode is created
 * or its status is manually reset to 'queued'.
 */
export const videoPipelineTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const change = event.data;
    if (!change || !change.after.exists) {
        return; // Document was deleted, no action needed.
    }
    
    const docRef = change.after.ref;
    const afterData = change.after.data() as Episode;
    const beforeData = change.before.exists ? change.before.data() as Episode : null;

    try {
        if (!process.env.KEK_SECRET || !process.env.GOOGLE_GENAI_API_KEY) {
            throw new Error(`Required secrets are missing. Function cannot start.`);
        }
        
        // Trigger only if the pipeline status is newly set to 'queued'.
        if (afterData.status?.pipeline === 'queued' && beforeData?.status?.pipeline !== 'queued') {
            console.log(`✨ [${episodeId}] New video pipeline job detected. Starting process...`);
            
            // The AI analysis will be triggered by a separate function watching for the completion of this one.
            await processAndEncryptVideo(episodeId, afterData.storage.rawPath, docRef);
        }
    } catch (e: any) {
        console.error(`[${episodeId}] UNHANDLED EXCEPTION in videoPipelineTrigger:`, e);
        await failPipeline(docRef, 'trigger-exception', e, '함수 트리거 레벨에서 예상치 못한 오류가 발생했습니다.');
    }
});

/**
 * Triggers the AI analysis pipeline after the video processing pipeline completes successfully.
 * It also handles the final deletion of the raw video file.
 */
export const aiAnalysisTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const change = event.data;
    if (!change || !change.after.exists || !change.before.exists) {
        // This trigger requires both 'before' and 'after' states to detect the specific status change.
        return;
    }
    
    const docRef = change.after.ref;
    const afterData = change.after.data() as Episode;
    const beforeData = change.before.data() as Episode;

    // Trigger only when the video pipeline has *just* been completed.
    if (afterData.status?.pipeline === 'completed' && beforeData.status?.pipeline !== 'completed') {
        console.log(`✅ [${episodeId}] Video pipeline finished. Starting AI analysis...`);
        try {
            await runAiAnalysis(episodeId, docRef, afterData);
            
            // After AI analysis is awaited, check the final status and decide whether to delete the raw file.
            const finalDoc = await docRef.get();
            const finalData = finalDoc.data() as Episode;
            
            // Only delete if AI analysis is definitively finished (completed or blocked).
            if (finalData.ai.status === 'completed' || finalData.ai.status === 'blocked') {
                if (finalData.storage.rawPath) {
                    await deleteStorageFileByPath(finalData.storage.rawPath);
                    await docRef.update({ 'storage.rawPath': admin.firestore.FieldValue.delete() });
                    console.log(`[${episodeId}] ✅ AI job finished. Original raw file deleted.`);
                }
            } else {
                 console.warn(`[${episodeId}] ⚠️ AI job did not complete successfully (status: ${finalData.ai.status}). Original file at ${finalData.storage.rawPath} was NOT deleted for manual inspection.`);
            }
        } catch (e: any) {
            console.error(`[${episodeId}] UNHANDLED EXCEPTION in aiAnalysisTrigger:`, e);
            // The runAiAnalysis function has its own error handling that updates the doc.
            // This catch block is for truly unexpected errors in the trigger logic itself.
        }
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
```

#### `src/api/play-session/route.ts`
```ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp, decryptMasterKey } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User, Episode } from '@/lib/types';

export async function POST(req: NextRequest) {
  console.log(`[API /api/play-session] Received request at ${new Date().toISOString()}`);
  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const auth = admin.auth(adminApp);

    // 1. Verify User Authentication
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const idToken = authorization.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // 2. Get videoId and deviceId
    const { videoId, deviceId } = await req.json();
    if (!videoId || !deviceId) {
      return NextResponse.json({ error: 'Bad Request: videoId and deviceId are required' }, { status: 400 });
    }

    // 3. Verify User Subscription & Video Playability
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return NextResponse.json({ error: 'Forbidden: User not found' }, { status: 403 });
    const userData = userDoc.data() as User;
    
    const episodeDoc = await db.collection('episodes').doc(videoId).get();
    if (!episodeDoc.exists) return NextResponse.json({ error: 'Not Found: Video not found' }, { status: 404 });
    const episodeData = episodeDoc.data() as Episode;
    
    if (!episodeData.status.playable) {
        return NextResponse.json({ error: `Forbidden: Video is not playable. Current status: ${episodeData.status.pipeline}` }, { status: 403 });
    }

    const subscription = userData.activeSubscriptions?.[episodeData.courseId];
    const isSubscribed = subscription && new Date() < (toJSDate(subscription.expiresAt) || new Date(0));

    if (!isSubscribed && !episodeData.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required' }, { status: 403 });
    }

    // 4. Retrieve and Decrypt Master Key
    const keyId = episodeData.encryption?.keyId;
    if (!keyId) return NextResponse.json({ error: 'Not Found: Encryption info missing for this video' }, { status: 404 });
    
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    
    const videoKeyData = keyDoc.data() as VideoKey;
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);

    // 5. Generate a session ID and Watermark Seed
    const sessionId = `online_sess_${crypto.randomBytes(12).toString('hex')}`;
    const watermarkSeed = crypto.createHash('sha256').update(`${userId}|${videoId}|${deviceId}|${sessionId}`).digest('hex');
    
    const derivedKeyB64 = masterKey.toString('base64');

    // 7. Return Session Info
    return NextResponse.json({
      sessionId: sessionId,
      derivedKeyB64: derivedKeyB64,
      expiresAt: Date.now() + 3600 * 1000,
      watermarkSeed: watermarkSeed,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[play-session API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
```

#### `src/api/offline-license/route.ts`
```ts
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp, decryptMasterKey, loadKEK } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User, Episode, OfflineLicense } from '@/lib/types';
import { add } from 'date-fns';

export async function POST(req: NextRequest) {
  // This log is added to force a new deployment and refresh environment variables.
  console.log(`[API /api/offline-license] Received request at ${new Date().toISOString()}`);
  try {
    // Attempt to load the KEK early to fail fast if it's not configured.
    // This prevents other logic from running unnecessarily.
    try {
        await loadKEK();
    } catch (kekError: any) {
        console.error('[OFFLINE-LICENSE-PRECHECK-FAILURE]', kekError.message);
        // This is a server configuration error, so we return a 500.
        return NextResponse.json({ error: `서버 설정 오류: ${kekError.message}` }, { status: 500 });
    }

    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const auth = admin.auth(adminApp);

    // 1. Verify User Authentication
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const idToken = authorization.split('Bearer ')[1];

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
    const userId = decodedToken.uid;

    // 2. Get videoId and deviceId from request body
    const { videoId, deviceId } = await req.json();
    if (!videoId || !deviceId) {
      return NextResponse.json({ error: 'Bad Request: videoId and deviceId are required' }, { status: 400 });
    }

    // 3. Verify User Subscription and Download Rights
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'Forbidden: User not found' }, { status: 403 });
    }
    const userData = userDoc.data() as User;
    
    const episodeDoc = await db.collection('episodes').doc(videoId).get();
    if (!episodeDoc.exists) {
        return NextResponse.json({ error: 'Not Found: Video not found' }, { status: 404 });
    }
    const episodeData = episodeDoc.data() as Episode;
    
    const courseId = episodeData.courseId;
    const subscription = userData.activeSubscriptions?.[courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required for download' }, { status: 403 });
    }

    // 4. Retrieve and Decrypt Master Key
    const keyId = episodeData.encryption.keyId;
    if (!keyId) {
        return NextResponse.json({ error: 'Not Found: Encryption info missing for this video' }, { status: 404 });
    }
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) {
      return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    }
    const videoKeyData = keyDoc.data() as VideoKey;
    if (!videoKeyData.encryptedMasterKey) {
        return NextResponse.json({ error: 'Internal Server Error: Master key is missing from key data.' }, { status: 500 });
    }
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);

    // 5. Generate Signature for the license & Watermark
    const issuedAt = Date.now();
    const expiresAt = add(issuedAt, { days: 7 }).getTime();
    const sessionId = `offline_sess_${crypto.randomBytes(12).toString('hex')}`;
    const watermarkSeed = crypto.createHash('sha256').update(`${userId}|${videoId}|${deviceId}|${sessionId}`).digest('hex');
    const signaturePayload = JSON.stringify({ videoId, userId, deviceId, expiresAt, watermarkSeed });

    const signature = crypto.createHmac('sha256', await loadKEK()).update(signaturePayload).digest('hex');

    // 6. Construct and return Offline License
    const license: Omit<OfflineLicense, 'signature' | 'offlineDerivedKey'> & { signature: string } = {
      videoId,
      userId,
      deviceId,
      issuedAt,
      expiresAt,
      keyId: videoKeyData.keyId,
      kekVersion: videoKeyData.kekVersion,
      watermarkSeed,
      policy: {
          maxDevices: 1,
          allowScreenCapture: false
      },
      signature: signature,
    };

    // CRITICAL FIX: Send the actual masterKey for decryption, not a derived one.
    return NextResponse.json({
        ...license,
        offlineDerivedKey: masterKey.toString('base64'),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[offline-license API Error]', error);
    // Return a 500 for any other unexpected errors during processing.
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
```

#### `src/workers/crypto.worker.ts`
```ts
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, EncryptionInfo } from '@/lib/types';

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = self.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const importKey = (keyBuffer: ArrayBuffer): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-256-GCM' }, false, ['decrypt']);
};

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type !== 'DECRYPT_SEGMENT') {
    return;
  }
  
  const { requestId, encryptedSegment, derivedKeyB64, encryption, storagePath } = event.data.payload;

  if (!encryptedSegment || !derivedKeyB64 || !encryption || !storagePath) {
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: { requestId, message: 'Incomplete data for decryption (missing segment, key, encryption info, or storagePath).' },
    };
    self.postMessage(response);
    return;
  }
  
  try {
    const keyBuffer = base64ToUint8Array(derivedKeyB64);
    const cryptoKey = await importKey(keyBuffer.buffer as ArrayBuffer);

    // From Spec 3 & 6.3: Use the segment's storage path as AAD.
    const aad = new TextEncoder().encode(`path:${storagePath}`);
    
    // From Spec 3: [IV(12)][CIPHERTEXT][TAG(16)]
    const iv = encryptedSegment.slice(0, encryption.ivLength);
    const ciphertextWithTag = encryptedSegment.slice(encryption.ivLength);

    const decryptedSegment = await self.crypto.subtle.decrypt(
      {
        name: 'AES-256-GCM',
        iv: iv,
        tagLength: encryption.tagLength * 8, // Convert bytes to bits
        additionalData: aad, // Add AAD for integrity check
      },
      cryptoKey,
      ciphertextWithTag
    );
    
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_SUCCESS',
      payload: { requestId, decryptedSegment },
    };
    
    self.postMessage(response, [decryptedSegment]);

  } catch (error: any) {
    console.error(`[Worker] ❌ Decryption failed for requestId ${requestId}:`, error);
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: {
        requestId,
        message: `Decryption failed in worker: ${error.message}`,
      },
    };
    self.postMessage(response);
  }
};

export {};
```

#### `src/components/shared/video-player-dialog.tsx`
```tsx
'use client';

import type { Episode, Instructor, Course, User, Bookmark, OfflineVideoData, CryptoWorkerResponse, PlayerState, ChatLog, ChatMessage, OfflineLicense, VideoManifest } from '@/lib/types';
import React from 'react';
import { Button } from '../ui/button';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection, useAuth } from '@/firebase';
import { Textarea } from '../ui/textarea';
import { Send, Bot, User as UserIcon, X, Loader, FileText, Clock, ChevronRight, Bookmark as BookmarkIcon, Trash2, Download, AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { askVideoTutor } from '@/ai/flows/video-tutor-flow';
import { cn, formatDuration } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { collection, query, where, orderBy, onSnapshot, Timestamp as FirebaseTimestamp, doc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { addBookmark, deleteBookmark, updateBookmarkNote } from '@/lib/actions/bookmark-actions';
import { Input } from '../ui/input';
import { saveVideo } from '@/lib/offline-db';
import { getSignedUrl as getSignedUrlAction } from '@/lib/actions/get-signed-url';


type DownloadState = 'idle' | 'checking' | 'downloading' | 'saving' | 'completed' | 'forbidden' | 'error';

const DownloadButton = ({
    downloadState,
    onDownload,
    reasonDisabled
}: {
    downloadState: DownloadState;
    onDownload: () => void;
    reasonDisabled?: string;
}) => {
    switch (downloadState) {
        case 'checking':
        case 'downloading':
        case 'saving':
            return (
                <Button variant="outline" disabled>
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                    {downloadState === 'checking' && '권한 확인 중...'}
                    {downloadState === 'downloading' && '다운로드 중...'}
                    {downloadState === 'saving' && '저장 중...'}
                </Button>
            );
        case 'completed':
            return (
                <Button variant="outline" disabled>
                    <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                    저장 완료
                </Button>
            );
        case 'forbidden':
            return (
                 <Button variant="outline" disabled title={reasonDisabled}>
                    <AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" />
                    저장 불가
                </Button>
            );
        case 'error':
            return (
                <Button variant="destructive" onClick={onDownload}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    다운로드 재시도
                </Button>
            );
        case 'idle':
        default:
            return (
                <Button variant="outline" onClick={onDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    오프라인 저장
                </Button>
            );
    }
};

const SyllabusView = ({ episode, onSeek }: { episode: Episode, onSeek: (timeInSeconds: number) => void; }) => {
    if (episode.ai.status === 'failed') {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
                <p className="font-semibold mt-4">AI 분석 실패</p>
                <p className="text-sm text-muted-foreground mt-2 break-keep">
                    강의 요약 및 타임라인을 생성하지 못했습니다.
                </p>
                {episode.ai.error?.message && (
                    <p className="text-xs text-muted-foreground mt-2 break-keep max-w-sm p-2 bg-destructive/10 rounded-md">
                        오류 원인: {episode.ai.error.message}
                    </p>
                )}
                 <p className="text-xs text-muted-foreground mt-4 break-keep">
                    관리자 페이지에서 재분석을 시도할 수 있습니다.
                </p>
            </div>
        );
    }
    
    // @ts-ignore - ai.resultPaths may not exist in all Episode types from history
    const aiContentString = episode.ai.resultPaths?.summary;
    // @ts-ignore
    const aiContent = aiContentString ? JSON.parse(aiContentString) : null;
    
    if (episode.ai.status !== 'completed' || !aiContent) {
        return (
            <div className="flex-grow flex flex-col items-center justify-center text-center p-4">
                <Loader className="h-12 w-12 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground mt-4 break-keep">AI가 강의 내용을 분석하고 있습니다.<br/>잠시 후 다시 시도해주세요.</p>
            </div>
        );
    }
    
    try {
        const data = aiContent;
        
        const parseTimeToSeconds = (timeStr: string): number => {
            if (!timeStr) return 0;
            const parts = timeStr.split(':').map(part => parseFloat(part.replace(',', '.')));
            if (parts.length === 3) {
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
            return 0;
        };

        return (
            <div className="space-y-4 p-4 pr-6">
                <div className="space-y-1">
                    <h4 className="font-semibold text-base">강의 요약</h4>
                    <p className="text-sm text-foreground whitespace-pre-line break-keep [word-break:keep-all]">{data.summary || '요약이 없습니다.'}</p>
                </div>
                {data.timeline && data.timeline.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="font-semibold flex items-center gap-2 text-base"><Clock className="w-4 h-4" />타임라인</h4>
                        <Accordion type="single" collapsible className="w-full">
                            {data.timeline.map((item: any, i: number) => (
                                <AccordionItem value={`item-${i}`} key={i} className="border rounded-md mb-1 bg-white overflow-hidden">
                                    <AccordionTrigger 
                                        className="text-sm hover:no-underline text-left px-3 py-2" 
                                        onClick={() => onSeek(parseTimeToSeconds(item.startTime))}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-primary font-bold">{item.startTime?.split('.')[0] || '00:00:00'}</span>
                                            <p className="whitespace-normal break-keep">{item.subtitle}</p> 
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3">
                                        <p className="text-sm text-foreground whitespace-pre-line break-keep">{item.description}</p>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>
                )}
            </div>
        )
    } catch(e) {
        return <div className="p-5 text-sm text-muted-foreground">콘텐츠 파싱 오류: AI가 생성한 데이터 형식이 올바르지 않습니다.</div>;
    }
};

const ChatView = ({ episode, user }: { episode: Episode; user: any }) => {
    const firestore = useFirestore();
    const [isPending, startTransition] = React.useTransition();
    const [userQuestion, setUserQuestion] = React.useState('');
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [chatError, setChatError] = React.useState<string | null>(null);
    const isAIAvailable = episode.ai.status === 'completed';

    React.useEffect(() => {
        if (!user || !firestore) return;
        setIsLoading(true);
        setChatError(null);
        
        const q = query(
            collection(firestore, 'users', user.id, 'chats'), 
            where('episodeId', '==', episode.id), 
            orderBy('createdAt', 'asc')
        );
        
        const unsubscribe = onSnapshot(q, 
            (snapshot) => {
                const logs = snapshot.docs.map(doc => doc.data() as ChatLog);
                const newMessages = logs.flatMap(log => {
                    const logDate = (log.createdAt as FirebaseTimestamp)?.toDate() || new Date();
                    return [
                        { id: `${log.id}-q`, role: 'user' as const, content: log.question, createdAt: logDate },
                        { id: `${log.id}-a`, role: 'model' as const, content: log.answer, createdAt: new Date(logDate.getTime() + 1) }
                    ];
                });
                setMessages(newMessages);
                setIsLoading(false);
                setChatError(null);
            },
            (error) => {
                console.error("ChatView snapshot listener error:", error);
                setChatError("채팅 기록을 불러오는 중 오류가 발생했습니다. Firestore 인덱스가 필요할 수 있습니다.");
                setIsLoading(false);
            }
        );
        return unsubscribe;
    }, [user, episode.id, firestore]);

    const handleAskQuestion = () => {
        if (!userQuestion.trim() || isPending) return;
        const questionContent = userQuestion.trim();
        setMessages(prev => [...prev, { id: uuidv4(), role: 'user', content: questionContent, createdAt: new Date() }]);
        setUserQuestion('');
        startTransition(async () => {
            try { await askVideoTutor({ episodeId: episode.id, question: questionContent, userId: user.id }); } 
            catch { setMessages(prev => [...prev, { id: uuidv4(), role: 'model', content: "죄송합니다, 답변 생성 중 오류가 발생했습니다.", createdAt: new Date() }]); }
        });
    };

    return (
        <div className="flex flex-col h-full p-4">
            <ScrollArea className="flex-grow pr-4">
                <div className="space-y-4">
                    {chatError ? (
                        <div className="text-center text-red-500 p-4 bg-red-50 rounded-md">
                            <AlertTriangle className="mx-auto h-8 w-8 mb-2"/>
                            <p className="text-sm font-semibold">{chatError}</p>
                        </div>
                    ) : isLoading ? (
                        <div className="text-center text-muted-foreground p-4">
                            <Loader className="mx-auto h-8 w-8 animate-spin"/>
                        </div>
                    ) : (
                        messages.map(m => (
                            <div key={m.id} className={cn("flex items-end gap-2", m.role === 'user' ? 'justify-end' : 'justify-start')}>
                                {m.role === 'model' && <Bot className="h-8 w-8 p-1 bg-primary text-white rounded-full" />}
                                <p className={cn("text-sm p-3 rounded-lg max-w-[80%]", m.role === 'user' ? 'bg-primary text-white' : 'bg-white border')}>{m.content}</p>
                            </div>
                        ))
                    )}
                    {isPending && <div className="text-xs text-muted-foreground animate-pulse">AI가 답변을 생각 중입니다...</div>}
                </div>
            </ScrollArea>
            <div className="pt-4 border-t flex gap-2">
                <Textarea value={userQuestion} onChange={(e) => setUserQuestion(e.target.value)} disabled={!isAIAvailable || !!chatError} className="h-10 min-h-0 resize-none" placeholder={isAIAvailable ? "비디오에 대해 질문하세요..." : "AI 분석 완료 후 사용 가능합니다."} />
                <Button onClick={handleAskQuestion} disabled={isPending || !isAIAvailable || !!chatError}><Send className="w-4 h-4"/></Button>
            </div>
        </div>
    );
};

const TextbookView = () => (
    <div className="h-full flex flex-col items-center justify-center p-10 text-center">
        <Image src="https://picsum.photos/seed/textbook/200/280" width={150} height={210} alt="교재" className="rounded-md shadow-md mb-4" />
        <p className="text-sm text-muted-foreground">교재 정보는 현재 준비 중입니다.</p>
        <Button className="mt-4 bg-orange-500 hover:bg-orange-600 text-white">교재 구매하기</Button>
    </div>
);

const BookmarkItem = ({ bookmark, onSeek, onDelete }: { bookmark: Bookmark, onSeek: (time: number) => void, onDelete: (id: string) => void }) => {
    const { user } = useUser();
    const [note, setNote] = React.useState(bookmark.note || '');
    const [isSaving, setIsSaving] = React.useState(false);
    const debounceTimer = React.useRef<NodeJS.Timeout | null>(null);

    const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setNote(val);
        setIsSaving(true);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(async () => {
            if (user) await updateBookmarkNote({ userId: user.id, bookmarkId: bookmark.id, note: val });
            setIsSaving(false);
        }, 1500);
    };

    return (
        <li className="group flex items-center gap-2 p-2 bg-white rounded-md border">
            <Button variant="ghost" onClick={() => onSeek(bookmark.timestamp)} className="font-mono text-primary font-bold px-1 h-8 text-xs">
                [{formatDuration(bookmark.timestamp)}]
            </Button>
            <Input value={note} onChange={handleNoteChange} className="flex-grow h-8 text-sm border-none focus-visible:ring-0" placeholder="메모 입력..." />
            {isSaving && <Loader className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Button variant="ghost" size="icon" onClick={() => onDelete(bookmark.id)} className="opacity-0 group-hover:opacity-100 text-destructive h-8 w-8"><Trash2 className="h-4 w-4"/></Button>
        </li>
    );
};

const BookmarkView = ({ episode, user, videoElement }: { episode: Episode; user: User, videoElement: HTMLVideoElement | null }) => {
    const firestore = useFirestore();
    const { toast } = useToast();
    const bQuery = useMemoFirebase(() => user && firestore ? query(collection(firestore, 'users', user.id, 'bookmarks'), where('episodeId', '==', episode.id), orderBy('timestamp', 'asc')) : null, [user, episode.id]);
    const { data: bookmarks, isLoading } = useCollection<Bookmark>(bQuery);

    const handleAdd = async () => {
        if (!videoElement || !user) return;
        const time = Math.floor(videoElement.currentTime);
        const res = await addBookmark({ userId: user.id, episodeId: episode.id, courseId: episode.courseId, timestamp: time, note: '' });
        if (res.success) toast({ title: "책갈피 추가 완료" });
    };

    return (
        <div className="p-4 space-y-4">
            <Button className="w-full bg-primary" onClick={handleAdd}><BookmarkIcon className="w-4 h-4 mr-2"/> 현재 시간 책갈피</Button>
            {isLoading ? <Loader className="mx-auto animate-spin" /> : (
                <ul className="space-y-2">
                    {bookmarks?.map(b => <BookmarkItem key={b.id} bookmark={b} onSeek={(t) => { if(videoElement) videoElement.currentTime = t; }} onDelete={(id) => deleteBookmark(user.id, id)} />)}
                    {bookmarks?.length === 0 && <p className="text-center text-xs text-muted-foreground pt-4">저장된 책갈피가 없습니다.</p>}
                </ul>
            )}
        </div>
    );
};

const PlayerStatusOverlay = ({ playerState, playerMessage }: { playerState: PlayerState, playerMessage: string | null }) => {
    
    let content: React.ReactNode = null;

    switch (playerState) {
        case 'idle':
        case 'playing':
        case 'paused':
        case 'ready':
             return null;
        case 'requesting-key':
        case 'downloading':
        case 'decrypting':
             return null;
        case 'recovering':
            content = (
                <>
                    <RotateCcw className="w-12 h-12 animate-spin mb-4"/>
                    <p className="font-bold">연결이 불안정하여 복구 중입니다...</p>
                    <p className="text-sm text-muted-foreground mt-1">{playerMessage}</p>
                </>
            );
            break;
        case 'error-fatal':
        case 'error-retryable':
        case 'license-expired':
             content = (
                <>
                    <AlertTriangle className="w-12 h-12 text-destructive mb-4"/>
                    <p className="font-semibold">{playerState === 'license-expired' ? '오프라인 라이선스 만료' : '재생 오류'}</p>
                    <p className="text-sm text-muted-foreground mt-1">{playerMessage}</p>
                </>
            );
            break;
    }
    
    return (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 text-center">
            {content}
        </div>
    );
};


const Watermark = ({ seed }: { seed: string | null }) => {
    const [positions, setPositions] = React.useState<{ top: string; left: string }[]>([]);
  
    React.useEffect(() => {
      if (seed) {
        const newPositions = Array.from({ length: 5 }).map(() => ({
          top: `${Math.random() * 80 + 10}%`,
          left: `${Math.random() * 80 + 10}%`,
        }));
        setPositions(newPositions);
      }
    }, [seed]);
  
    if (!seed) return null;
  
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {positions.map((pos, i) => (
          <span
            key={i}
            className="absolute text-white/10 text-xs"
            style={{ ...pos, transform: 'rotate(-15deg)' }}
          >
            {seed}
          </span>
        ))}
      </div>
    );
  };

interface VideoPlayerDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  episode: Episode;
  instructor?: Instructor | null;
  offlineVideoData?: OfflineVideoData;
}


// ========= MAIN COMPONENT =========

export default function VideoPlayerDialog({ isOpen, onOpenChange, episode, instructor, offlineVideoData }: VideoPlayerDialogProps) {
    const { user, authUser } = useUser();
    const { toast } = useToast();
    const firestore = useFirestore();
    const [playerState, setPlayerState] = React.useState<PlayerState>('idle');
    const [playerMessage, setPlayerMessage] = React.useState<string | null>(null);
    
    const [watermarkSeed, setWatermarkSeed] = React.useState<string | null>(null);
    const [downloadState, setDownloadState] = React.useState<DownloadState>('idle');
    const [downloadDisabledReason, setDownloadDisabledReason] = React.useState<string | undefined>();

    const videoRef = React.useRef<HTMLVideoElement>(null);
    const workerRef = React.useRef<Worker | null>(null);
    const mediaSourceRef = React.useRef<MediaSource | null>(null);
    const sourceBufferRef = React.useRef<SourceBuffer | null>(null);
    const activeRequestIdRef = React.useRef<string | null>(null);
    const segmentQueueRef = React.useRef<string[]>([]);
    const currentSegmentIndexRef = React.useRef(0);
    // This ref will securely hold the decryption key only in component memory.
    const decryptionKeyRef = React.useRef<string | null>(null);
    
    const courseRef = useMemoFirebase(() => (firestore ? doc(firestore, 'courses', episode.courseId) : null), [firestore, episode.courseId]);
    const { data: course } = useDoc<Course>(courseRef);

    const handleSeek = (timeInSeconds: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = timeInSeconds;
            video.play().catch(() => {});
            toast({ title: "이동 완료", description: `${formatDuration(timeInSeconds)} 지점입니다.` });
        }
    };

    const handleDownload = React.useCallback(async () => {
        if (!authUser || !course) {
            setDownloadDisabledReason('사용자 또는 강좌 정보를 불러올 수 없습니다.');
            setDownloadState('forbidden');
            return;
        }

        setDownloadState('checking');
        try {
            const token = await authUser.getIdToken();
            const res = await fetch('/api/offline-license', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({ videoId: episode.id, deviceId: 'web-offline-v1' })
            });

            if (!res.ok) {
                const { error } = await res.json();
                throw new Error(error || '라이선스 발급에 실패했습니다.');
            }
            const license: OfflineLicense = await res.json();
            
            setDownloadState('downloading');
            const manifestRes = await getSignedUrlAction(token, episode.id, episode.storage.manifestPath);
            if (manifestRes.error) throw new Error(manifestRes.error);
            
            const manifestData: VideoManifest = await (await fetch(manifestRes.signedUrl!)).json();

            setDownloadState('saving');
            const dataToSave: OfflineVideoData = {
                episode,
                courseName: course.name,
                downloadedAt: new Date(),
                license,
                manifest: manifestData,
                segments: new Map() // Segments will be fetched and added by saveVideo
            };
            await saveVideo(dataToSave);

            setDownloadState('completed');
            toast({ title: '저장 완료', description: `'${episode.title}'을(를) 오프라인으로 저장했습니다.` });

        } catch (error: any) {
            console.error("Download failed:", error);
            setDownloadState('error');
            setDownloadDisabledReason(error.message);
            toast({ variant: 'destructive', title: '저장 실패', description: error.message });
        }
    }, [authUser, course, episode, toast]);

    const getSignedUrl = async (token: string, videoId: string, fileName: string) => {
        const { signedUrl, error } = await getSignedUrlAction(token, videoId, fileName);
        if (error || !signedUrl) {
            throw new Error(`URL 요청 실패 (${fileName}): ${error || 'Unknown error'}`);
        }
        return signedUrl;
    };
    
    const cleanup = React.useCallback(() => {
        workerRef.current?.terminate();
        workerRef.current = null;
        activeRequestIdRef.current = null;
        // Securely clear the key from memory.
        decryptionKeyRef.current = null;
        
        const video = videoRef.current;
        if (video && video.src) {
             try {
                URL.revokeObjectURL(video.src);
                video.removeAttribute('src');
                video.load();
            } catch (e) {}
        }
        mediaSourceRef.current = null;
        sourceBufferRef.current = null;
        setPlayerState('idle');

    }, []);

    const startPlayback = React.useCallback(async (requestId: string) => {
        cleanup(); 
        activeRequestIdRef.current = requestId;

        if (episode.status?.pipeline === 'failed') {
            setPlayerState('error-fatal');
            setPlayerMessage(episode.status.error?.message || '비디오 처리 중 오류 발생.');
            return;
        }

        if (!episode.storage.manifestPath || !episode.encryption?.keyId) {
            setPlayerState('error-fatal');
            setPlayerMessage('필수 재생 정보(manifest, keyId)가 누락되었습니다.');
            return;
        }

        const ms = new MediaSource();
        mediaSourceRef.current = ms;
        
        workerRef.current = new Worker(new URL('../../workers/crypto.worker.ts', import.meta.url));

        const fetchAndProcessNextSegment = async () => {
            const sb = sourceBufferRef.current;
            if (!sb || sb.updating) {
                return;
            }

            const segmentIndex = currentSegmentIndexRef.current;
            if (segmentIndex >= segmentQueueRef.current.length) {
                if (ms.readyState === 'open' && !sb.updating) {
                    ms.endOfStream();
                }
                return;
            }

            try {
                const segmentPath = segmentQueueRef.current[segmentIndex];
                
                let segmentBuffer: ArrayBuffer;
                if(offlineVideoData) {
                    segmentBuffer = offlineVideoData.segments.get(segmentPath)!;
                    if(!segmentBuffer) throw new Error(`Offline segment not found: ${segmentPath}`);
                } else {
                    const token = await authUser?.getIdToken();
                    const url = await getSignedUrl(token!, episode.id, segmentPath);
                    const res = await fetch(url);
                    segmentBuffer = await res.arrayBuffer();
                }
                
                // CRITICAL: The 'storagePath' for AAD verification must EXACTLY match the path
                // used on the server during encryption. Here, we pass the 'path' from the manifest.
                // The key is now sourced from a secure ref instead of the window object.
                workerRef.current?.postMessage({
                  type: 'DECRYPT_SEGMENT',
                  payload: { 
                      requestId: `${requestId}-${segmentIndex}`, 
                      encryptedSegment: segmentBuffer, 
                      derivedKeyB64: decryptionKeyRef.current, 
                      encryption: episode.encryption, 
                      storagePath: segmentPath 
                  }
                });
            } catch (e: any) {
                console.error(`Error fetching segment ${segmentIndex}:`, e);
            }
        };

        workerRef.current.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
            const { type, payload } = event.data;
            if (type === 'DECRYPT_SUCCESS') {
                const { decryptedSegment } = payload;
                const sb = sourceBufferRef.current;
                
                const append = () => {
                    if (sb?.updating) {
                        sb.addEventListener('updateend', append, { once: true });
                        return;
                    }
                    try {
                        sb?.appendBuffer(decryptedSegment);
                    } catch (e: any) {
                        setPlayerState('error-fatal');
                        setPlayerMessage(`미디어 버퍼 추가 실패: ${e.message}`);
                    }
                }
                append();

            } else {
                setPlayerState('error-fatal');
                setPlayerMessage(`복호화 실패: ${payload.message}`);
            }
        };
        
        ms.addEventListener('sourceopen', async () => {
            try {
                let manifest: VideoManifest;
                
                if (offlineVideoData) {
                    if (new Date() > new Date(offlineVideoData.license.expiresAt)) {
                        throw new Error("오프라인 라이선스가 만료되었습니다.");
                    }
                    manifest = offlineVideoData.manifest;
                    decryptionKeyRef.current = offlineVideoData.license.offlineDerivedKey;
                    setWatermarkSeed(offlineVideoData.license.watermarkSeed);
                } else {
                    if (!authUser) throw new Error("로그인 필요");
                    const token = await authUser.getIdToken();
                    const sessionRes = await fetch('/api/play-session', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ videoId: episode.id, deviceId: 'web-online' })
                    });
                    if (!sessionRes.ok) throw new Error(`보안 세션 시작 실패: ${sessionRes.status}`);
                    const sessionData = await sessionRes.json();
                    decryptionKeyRef.current = sessionData.derivedKeyB64;
                    setWatermarkSeed(sessionData.watermarkSeed);
                    
                    const manifestUrl = await getSignedUrl(token, episode.id, episode.storage.manifestPath!);
                    const manifestRes = await fetch(manifestUrl);
                    manifest = await manifestRes.json();
                }

                if (!decryptionKeyRef.current) {
                    throw new Error("Decryption key is missing.");
                }

                const mimeCodec = manifest.codec;
                if (!MediaSource.isTypeSupported(mimeCodec)) {
                    throw new Error(`코덱을 지원하지 않습니다: ${mimeCodec}`);
                }
                
                const sourceBuffer = ms.addSourceBuffer(mimeCodec);
                sourceBufferRef.current = sourceBuffer;
                
                sourceBuffer.addEventListener('updateend', () => {
                    currentSegmentIndexRef.current++;
                    fetchAndProcessNextSegment();
                });
                
                segmentQueueRef.current = [manifest.init, ...manifest.segments.map(s => s.path)];
                currentSegmentIndexRef.current = 0;

                fetchAndProcessNextSegment();

            } catch (e: any) {
                console.error("Playback setup failed:", e);
                setPlayerState('error-fatal');
                setPlayerMessage(e.message);
            }
        }, { once: true });
        
        if (videoRef.current) {
            videoRef.current.src = URL.createObjectURL(ms);
        }

    }, [cleanup, offlineVideoData, authUser, episode]);

    React.useEffect(() => {
        if (isOpen && videoRef.current) {
            const initialRequestId = uuidv4();
            startPlayback(initialRequestId);
        } else if (!isOpen) {
            cleanup();
        }
        
        return cleanup;
    }, [isOpen, startPlayback, cleanup]);
    
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-none w-full h-full p-0 flex flex-col border-0 md:max-w-[96vw] md:h-[92vh] md:rounded-2xl overflow-hidden shadow-2xl">
         <div className="flex flex-row h-12 items-center justify-between border-b bg-white pl-4 pr-12 flex-shrink-0 relative">
            <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-bold truncate">
                    {course?.name} <ChevronRight className="inline w-4 h-4 mx-1 text-muted-foreground"/> {episode.title}
                </DialogTitle>
                <DialogDescription className="sr-only">비디오 재생 및 관련 정보 다이얼로그</DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                 {!offlineVideoData && (
                    <DownloadButton 
                        downloadState={downloadState} 
                        onDownload={handleDownload}
                        reasonDisabled={downloadDisabledReason}
                    />
                )}
            </div>
        </div>
        
        <div className="flex-1 flex flex-col md:grid md:grid-cols-10 bg-muted/30 min-h-0">
            <div className="col-span-10 md:col-span-7 bg-black relative flex items-center justify-center aspect-video md:aspect-auto md:min-h-0">
                <PlayerStatusOverlay playerState={playerState} playerMessage={playerMessage} />
                <video ref={videoRef} className="w-full h-full" autoPlay playsInline controls />
                <Watermark seed={watermarkSeed} />
            </div>

            <div className="col-span-10 md:col-span-3 bg-white border-l flex flex-col min-h-0 flex-1 md:flex-auto">
                <Tabs defaultValue="syllabus" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-4 rounded-none border-b h-12 bg-gray-50/50 flex-shrink-0">
                        <TabsTrigger value="syllabus" className="text-xs">강의목차</TabsTrigger>
                        <TabsTrigger value="search" className="text-xs">강의검색</TabsTrigger>
                        <TabsTrigger value="textbook" className="text-xs">교재정보</TabsTrigger>
                        <TabsTrigger value="bookmark" className="text-xs">책갈피</TabsTrigger>
                    </TabsList>
                    <div className="flex-1 min-h-0">
                        <TabsContent value="syllabus" className="mt-0 h-full">
                            <ScrollArea className="h-full"><SyllabusView episode={episode} onSeek={handleSeek}/></ScrollArea>
                        </TabsContent>
                        <TabsContent value="search" className="mt-0 h-full">{user ? <ChatView episode={episode} user={user}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                        <TabsContent value="textbook" className="mt-0 h-full"><TextbookView /></TabsContent>
                        <TabsContent value="bookmark" className="mt-0 h-full">{user ? <BookmarkView episode={episode} user={user} videoElement={videoRef.current}/> : <p className="p-10 text-center text-xs">로그인이 필요합니다.</p>}</TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### `src/lib/offline-db.ts`
```ts
'use client';

import type { OfflineVideoData, OfflineVideoInfo, VideoManifest } from './types';
import { getSignedUrl as getSignedUrlAction } from '@/lib/actions/get-signed-url';
import { getAuth } from 'firebase/auth';

const DB_NAME = 'LlineStreamOffline';
const DB_VERSION = 2; // Increment version for schema change
const VIDEOS_STORE = 'videos';
const SEGMENTS_STORE = 'segments';

let db: IDBDatabase | null = null;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('IndexedDB 열기에 실패했습니다.'));
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(VIDEOS_STORE)) {
        dbInstance.createObjectStore(VIDEOS_STORE, { keyPath: 'episode.id' });
      }
      if (!dbInstance.objectStoreNames.contains(SEGMENTS_STORE)) {
        // Segments are stored with a key: `${episodeId}-${segmentPath}`
        dbInstance.createObjectStore(SEGMENTS_STORE);
      }
    };
  });
};

export const saveVideo = async (data: OfflineVideoData): Promise<void> => {
    const dbInstance = await initDB();

    // 1. Save metadata (everything except the segments map) to the 'videos' store.
    const metadataToSave = {
        episode: data.episode,
        courseName: data.courseName,
        downloadedAt: data.downloadedAt,
        license: data.license,
        manifest: data.manifest,
    };
    
    const metaTransaction = dbInstance.transaction(VIDEOS_STORE, 'readwrite');
    const metaStore = metaTransaction.objectStore(VIDEOS_STORE);
    metaStore.put(metadataToSave);

    await new Promise<void>((resolve, reject) => {
        metaTransaction.oncomplete = () => resolve();
        metaTransaction.onerror = (e) => reject(new Error('메타데이터 저장에 실패했습니다: ' + (e.target as any)?.error?.message));
    });
    
    // 2. Fetch and store all segments in parallel batches.
    const segmentPaths = [data.manifest.init, ...data.manifest.segments.map(s => s.path)];
    const concurrencyLimit = 5;

    for (let i = 0; i < segmentPaths.length; i += concurrencyLimit) {
        const batchPaths = segmentPaths.slice(i, i + concurrencyLimit);

        // Download a batch of segments in parallel.
        const downloadedSegments = await Promise.all(batchPaths.map(async (path) => {
            const auth = getAuth();
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Authentication token not found.");
            
            const { signedUrl, error } = await getSignedUrlAction(token, data.episode.id, path);
            if (error || !signedUrl) throw new Error(error || "Failed to get signed URL for segment.");

            const response = await fetch(signedUrl);
            if (!response.ok) throw new Error(`Failed to fetch segment: ${response.statusText}`);
            const segmentBuffer = await response.arrayBuffer();
            
            // Key format is crucial for retrieval and deletion.
            return { key: `${data.episode.id}-${path}`, value: segmentBuffer };
        }));

        // Save the downloaded batch to the 'segments' store in a single transaction.
        const segmentTransaction = dbInstance.transaction(SEGMENTS_STORE, 'readwrite');
        const segmentStore = segmentTransaction.objectStore(SEGMENTS_STORE);
        downloadedSegments.forEach(segment => {
            segmentStore.put(segment.value, segment.key);
        });

        await new Promise<void>((resolve, reject) => {
            segmentTransaction.oncomplete = () => resolve();
            segmentTransaction.onerror = (e) => reject(new Error('세그먼트 저장에 실패했습니다: ' + (e.target as any)?.error?.message));
        });
    }
};

export const getDownloadedVideo = async (episodeId: string): Promise<OfflineVideoData | null> => {
  const dbInstance = await initDB();

  // 1. Get the metadata object from the 'videos' store.
  const metadata: Omit<OfflineVideoData, 'segments'> | null = await new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(VIDEOS_STORE, 'readonly');
    const store = transaction.objectStore(VIDEOS_STORE);
    const request = store.get(episodeId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(new Error('메타데이터를 불러오는 데 실패했습니다: ' + (e.target as any)?.error?.message));
  });

  if (!metadata) {
    return null;
  }

  // 2. Efficiently fetch all segments for the episode using a cursor and key range.
  const segments = new Map<string, ArrayBuffer>();
  const keyRange = IDBKeyRange.bound(`${episodeId}-`, `${episodeId}-~`); // '~' is a high Unicode character

  await new Promise<void>((resolve, reject) => {
      const transaction = dbInstance.transaction(SEGMENTS_STORE, 'readonly');
      const store = transaction.objectStore(SEGMENTS_STORE);
      const request = store.openCursor(keyRange);

      request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
              const fullKey = cursor.key as string;
              // Extract the original path from the compound key.
              const path = fullKey.substring(episodeId.length + 1);
              segments.set(path, cursor.value);
              cursor.continue();
          } else {
              resolve(); // Cursor finished.
          }
      };
      request.onerror = (e) => reject(new Error('세그먼트를 불러오는 중 오류가 발생했습니다: ' + (e.target as any)?.error?.message));
  });

  // 3. Combine metadata and segments into the expected data structure for the player.
  return { ...metadata, segments };
};

export const listDownloadedVideos = async (): Promise<OfflineVideoInfo[]> => {
  const dbInstance = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(VIDEOS_STORE, 'readonly');
    const store = transaction.objectStore(VIDEOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const allData: OfflineVideoData[] = request.result;
      const infoList: OfflineVideoInfo[] = allData.map(d => ({
        episodeId: d.episode.id,
        title: d.episode.title,
        courseName: d.courseName,
        thumbnailUrl: d.episode.thumbnailUrl,
        downloadedAt: d.downloadedAt,
        expiresAt: new Date(d.license.expiresAt),
      }));
      resolve(infoList.sort((a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime()));
    };
    request.onerror = (e) => reject(new Error('다운로드 목록을 불러오는 데 실패했습니다: ' + (e.target as any)?.error?.message));
  });
};

export const deleteVideo = async (episodeId: string): Promise<void> => {
    const dbInstance = await initDB();

    // Use a single transaction to delete from both stores.
    const transaction = dbInstance.transaction([VIDEOS_STORE, SEGMENTS_STORE], 'readwrite');
    
    // 1. Delete metadata from 'videos' store.
    transaction.objectStore(VIDEOS_STORE).delete(episodeId);

    // 2. Delete all segments from 'segments' store using a key range.
    const keyRange = IDBKeyRange.bound(`${episodeId}-`, `${episodeId}-~`);
    transaction.objectStore(SEGMENTS_STORE).delete(keyRange);

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error('비디오 삭제에 실패했습니다: ' + (e.target as any)?.error?.message));
    });
};
```

#### `src/lib/actions/get-signed-url.ts`
```ts
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

/**
 * Server Action to generate a signed URL for a Firebase Storage file.
 * This is necessary because client-side SDKs cannot generate signed URLs.
 *
 * @param token - The user's Firebase Auth ID token for verification.
 * @param videoId - The ID of the episode, used for context (optional, but good for logging/validation).
 * @param filePath - The full path to the file in Firebase Storage.
 * @returns An object with either the signedUrl or an error message.
 */
export async function getSignedUrl(
  token: string,
  videoId: string,
  filePath: string
): Promise<{ signedUrl?: string; error?: string }> {
  try {
    const adminApp = await initializeAdminApp();
    const auth = admin.auth(adminApp);
    const storage = admin.storage(adminApp);

    // Verify the user's token to ensure they are a legitimate user
    // This is a basic check; full subscription/access rights should be checked in the calling context if needed.
    await auth.verifyIdToken(token);

    if (!filePath) {
      throw new Error('File path is required.');
    }

    const [signedUrl] = await storage
      .bucket()
      .file(filePath)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
        virtualHostedStyle: true,
      });

    return { signedUrl };
    
  } catch (error: any) {
    console.error(`[getSignedUrl Error] for video ${videoId}, path ${filePath}:`, error);
    return { error: `Failed to get signed URL: ${error.message}` };
  }
}
```