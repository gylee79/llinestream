/**
 * @fileoverview LlineStream Video Processing Pipeline v8.1
 * Implements a robust, two-stage workflow for video processing and AI analysis
 * using two separate, independently triggered Cloud Functions.
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
const { path: ffprobePath } = require('ffprobe-static');
import type { Episode, PipelineStatus } from './lib/types';

// 0. SDK Initialization and Global Config
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
  return { genAI, fileManager };
}

async function failPipeline(docRef: admin.firestore.DocumentReference, step: PipelineStatus['step'], error: any, hint?: string) {
    const rawError = (error instanceof Error) ? error.message : String(error);
    const updatePayload: any = {
        'status.pipeline': 'failed', 'status.step': step, 'status.progress': 100,
        'status.error': {
            step: step,
            code: error.code || 'UNKNOWN',
            message: rawError, hint: hint || '해당 단계에서 처리 중 오류가 발생했습니다.',
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
            ts: admin.firestore.FieldValue.serverTimestamp()
        },
        'ai.status': 'blocked',
        'ai.error': {
            code: 'PIPELINE_FAILED',
            message: '비디오 처리 파이프라인이 실패하여 AI 분석을 건너뜁니다.',
            ts: admin.firestore.FieldValue.serverTimestamp()
        }
    };
    if (step !== 'validate') {
        updatePayload['status.playable'] = false;
    }
    await docRef.update(updatePayload);
    console.error(`[${docRef.id}] ❌ Pipeline Failed at step '${step}':`, rawError);
}


// --- FUNCTION 1: Video Processing Pipeline ---
export const videoPipelineTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists) return; // Deleted

    const afterData = change.after.data() as Episode;
    const beforeData = change.before.exists ? change.before.data() as Episode : null;
    
    // GUARD: Only trigger on creation or manual reset to 'pending'
    if (afterData.status?.pipeline !== 'pending' || beforeData?.status?.pipeline === 'pending') {
        return;
    }

    const { episodeId } = event.params;
    const docRef = change.after.ref;
    console.log(`[${episodeId}] 🚀 videoPipelineTrigger activated.`);

    // STAGE 0: Validation
    if (!afterData.storage?.rawPath || !(await bucket.file(afterData.storage.rawPath).exists())[0]) {
        await failPipeline(docRef, 'validate', new Error("RawPath Missing or file does not exist."));
        return;
    }

    // STAGE 1: Video Core Processing
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-${episodeId}-`));
    try {
        await docRef.update({ 'status.pipeline': 'processing', 'status.step': 'transcode', 'status.progress': 10 });
        const localInputPath = path.join(tempDir, 'original_video');
        await bucket.file(afterData.storage.rawPath).download({ destination: localInputPath });
        
        const probeData = await new Promise<ffmpeg.FfprobeData>((res, rej) => ffmpeg.ffprobe(localInputPath, (err, data) => err ? rej(err) : res(data)));
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;

        // Thumbnail Generation
        const defaultThumbnailPath = path.join(tempDir, 'default_thumb.jpg');
        await new Promise<void>((res, rej) => ffmpeg(localInputPath).seekInput(duration / 2).frames(1).output(defaultThumbnailPath).on('error', rej).on('end', () => res()).run());
        const defaultThumbStoragePath = `episodes/${episodeId}/thumbnails/default.jpg`;
        await bucket.upload(defaultThumbnailPath, { destination: defaultThumbStoragePath });
        const defaultThumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(defaultThumbStoragePath)}?alt=media`;

        // FFmpeg Transcode & Segment
        const fragmentedMp4Path = path.join(tempDir, 'frag.mp4');
        await new Promise<void>((res, rej) => {
            const command = ffmpeg(localInputPath).videoCodec('libx264').outputOptions(['-vf', 'scale=-2:1080']);
            if (audioStream) command.audioCodec('aac');
            command.outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4').on('error', rej).on('end', () => res()).save(fragmentedMp4Path);
        });
        await new Promise<void>((res, rej) => {
            ffmpeg(fragmentedMp4Path).outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`]).on('error', rej).on('end', () => res()).save(path.join(tempDir, 'manifest.mpd'));
        });

        // Encryption
        await docRef.update({ 'status.step': 'encrypt', 'status.progress': 50 });
        const createdFiles = await fs.readdir(tempDir);
        const segmentNames = ['init.mp4', ...createdFiles.filter(f => f.startsWith('segment_')).sort()];
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
        
        // Manifest & Key Storage
        await docRef.update({ 'status.step': 'manifest', 'status.progress': 90 });
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        const manifest = {
            codec: audioStream ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` : `video/mp4; codecs="avc1.42E01E"`,
            duration: Math.round(duration),
            init: processedSegments.find(s => s.name === 'init.mp4')?.path,
            segments: processedSegments.filter(s => s.name !== 'init.mp4').map(s => ({ path: s.path })),
        };
        await bucket.file(manifestPath).save(JSON.stringify(manifest));

        const kek = await loadKEK();
        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, kekCipher.update(masterKey), kekCipher.final(), kekCipher.getAuthTag()]);
        await db.collection('video_keys').doc(keyId).set({ encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'), kekVersion: 1 });

        // Final Update to trigger AI stage
        await docRef.update({
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath, 'storage.manifestPath': manifestPath,
            'thumbnails.default': defaultThumbUrl, 'thumbnails.defaultPath': defaultThumbStoragePath,
            'thumbnailUrl': afterData.thumbnails.custom || defaultThumbUrl,
            'encryption': { algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, keyId, kekVersion: 1, aadMode: "path", segmentDurationSec: 4, fragmentEncrypted: true },
            'status.pipeline': 'completed', 'status.playable': true, 'status.step': 'done', 'status.progress': 100, 'status.error': null,
            'ai.status': 'queued',
        });
        console.log(`[${episodeId}] ✅ videoPipelineTrigger finished successfully.`);

    } catch (e: any) {
        await failPipeline(docRef, e.step || 'unknown', e.error || e);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
});


// --- FUNCTION 2: AI Analysis and Cleanup ---
export const aiAnalysisTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change?.after.exists || !change.before.exists) return;

    const afterData = change.after.data() as Episode;
    const beforeData = change.before.data() as Episode;

    // GUARD: Only trigger when AI status moves to 'queued'
    if (afterData.ai?.status !== 'queued' || beforeData.ai?.status === 'queued') {
        return;
    }
    
    const { episodeId } = event.params;
    const docRef = change.after.ref;
    console.log(`[${episodeId}] 🚀 aiAnalysisTrigger activated.`);
    
    // STAGE 2: AI Intelligence
    if (!afterData.storage.rawPath) {
        console.error(`[${episodeId}] AI analysis cannot run because rawPath is missing.`);
        await docRef.update({ 'ai.status': 'failed', 'ai.error': { code: 'RAWPATH_MISSING', message: 'Original video file path not found for analysis.' }});
        return;
    }

    initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile: any = null;

    try {
        await docRef.update({ 'ai.status': 'processing', 'ai.model': 'gemini-2.5-flash' });
        await bucket.file(afterData.storage.rawPath).download({ destination: tempFilePath });
        
        const uploadResponse = await fileManager!.uploadFile(tempFilePath, { mimeType: 'video/mp4' });
        uploadedFile = uploadResponse.file;
        
        let state = uploadedFile.state;
        while (state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const freshFile = await fileManager!.getFile(uploadedFile.name);
            state = freshFile.state;
        }
        if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

        const model = genAI!.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const prompt = "상세 요약(summary), 타임라인(timeline), 전체 대본(transcript) 뿐만 아니라, AI 검색/채팅을 위한 핵심 키워드(keywords)와 주제(topics)를 JSON으로 추출할 것.";
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        const output = JSON.parse(result.response.text());

        const searchDataPath = `episodes/${episodeId}/ai/search_data.json`;
        await bucket.file(searchDataPath).save(JSON.stringify(output));

        await docRef.update({ 'ai.status': 'completed', 'ai.resultPaths': { search_data: searchDataPath }, 'ai.error': null });
        console.log(`[${episodeId}] ✅ AI analysis succeeded.`);

    } catch (e: any) {
        await docRef.update({
            'ai.status': 'failed',
            'ai.error': { code: 'AI_PROCESSING_FAILED', message: e.message || 'Unknown AI error' }
        });
        console.error(`[${episodeId}] ❌ AI analysis failed.`, e);
    } finally {
        if (uploadedFile) { try { await fileManager!.deleteFile(uploadedFile.name); } catch (e) {} }
        try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
        
        // STAGE 3: Cleanup (runs regardless of AI success/fail)
        if (afterData.storage.rawPath) {
            await deleteStorageFileByPath(afterData.storage.rawPath);
            await docRef.update({ 'storage.rawPath': admin.firestore.FieldValue.delete() });
            console.log(`[${episodeId}] ✅ Cleanup complete. Original file deleted.`);
        }
    }
});


// --- FUNCTION 3: Cleanup on Deletion ---
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

export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const prefix = `episodes/${event.params.episodeId}/`;
    await bucket.deleteFiles({ prefix }).catch(e => console.error(`Failed to delete files for episode ${event.params.episodeId}`, e));
    const keyId = event.data?.data().encryption?.keyId;
    if (keyId) {
        await db.collection('video_keys').doc(keyId).delete().catch(e => console.error(`Failed to delete key ${keyId}`, e));
    }
});
