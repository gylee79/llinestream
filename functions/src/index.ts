
'use server';

/**
 * @fileoverview LlineStream Video Processing Pipeline v8.1 (Decoupled)
 *
 * Implements a fully decoupled, two-stage workflow for video processing and AI analysis
 * as per the final architectural decision.
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


// 0. Initialize SDKs and Global Configuration
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
  timeoutSeconds: 540, // 9 minutes
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

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");
  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager };
}

async function updateDoc(docRef: admin.firestore.DocumentReference, data: object) {
    await docRef.update({ ...data, 'status.updatedAt': admin.firestore.FieldValue.serverTimestamp() });
}

async function failPipeline(docRef: admin.firestore.DocumentReference, step: PipelineStatus['step'], error: any) {
    const rawError = (error instanceof Error) ? error.message : String(error);
    await docRef.update({
        'status.pipeline': 'failed',
        'status.playable': false,
        'status.error': { 
            step: step, 
            message: rawError, 
            ts: admin.firestore.FieldValue.serverTimestamp(),
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error)) 
        },
        'ai.status': 'blocked',
        'ai.error': { code: 'PIPELINE_FAILED', message: '비디오 처리 파이프라인 실패로 AI 분석이 차단되었습니다.' }
    });
    console.error(`[${docRef.id}] ❌ Pipeline Failed at step '${step}':`, rawError);
}


// 2. Stage 1: Video Core Processing Trigger
export const videoPipelineTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    if (!event.data) return;

    const before = event.data.before.data() as Episode | undefined;
    const after = event.data.after.data() as Episode;

    // Trigger only if the pipeline status is newly set to 'pending'.
    if (before?.status?.pipeline === 'pending' && after?.status?.pipeline === 'pending') return;
    if (after?.status?.pipeline !== 'pending') return;
    
    const { id: episodeId } = after;
    const docRef = event.data.after.ref;
    
    let currentStep: PipelineStatus['step'] = 'preparing';
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-${episodeId}-`));

    try {
        const { rawPath } = after.storage;
        if (!rawPath || !(await bucket.file(rawPath).exists())[0]) {
            throw new Error("storage.rawPath is missing or file does not exist in Storage.");
        }
        
        // This log is added to force a new deployment and refresh environment variables.
        console.log(`[videoPipelineTrigger] Function instance created for ${episodeId}`);

        await updateDoc(docRef, { 'status.pipeline': 'processing', 'status.step': currentStep, 'status.progress': 5 });
        const localInputPath = path.join(tempDir, 'original_video');
        await bucket.file(rawPath).download({ destination: localInputPath });

        currentStep = 'transcoding';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 10 });
        const probeData = await new Promise<ffmpeg.FfprobeData>((res, rej) => ffmpeg.ffprobe(localInputPath, (err, data) => err ? rej(err) : res(data)));
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;
        
        const fragmentedMp4Path = path.join(tempDir, 'frag.mp4');
        await new Promise<void>((resolve, reject) => {
            const command = ffmpeg(localInputPath).videoCodec('libx264').outputOptions(['-vf', 'scale=-2:1080']);
            if (audioStream) command.audioCodec('aac');
            command.outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                   .toFormat('mp4').on('error', reject).on('end', () => resolve()).save(fragmentedMp4Path);
        });

        await new Promise<void>((resolve, reject) => {
            ffmpeg(fragmentedMp4Path).outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                   .on('error', reject).on('end', () => resolve()).save(path.join(tempDir, 'manifest.mpd'));
        });

        currentStep = 'thumbnail';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 40 });
        const defaultThumbnailPath = path.join(tempDir, 'default_thumb.jpg');
        await new Promise<void>((resolve, reject) => {
            ffmpeg(localInputPath).seekInput(duration * 0.5).frames(1).output(defaultThumbnailPath)
                .on('error', reject).on('end', () => resolve()).run();
        });

        currentStep = 'encrypting';
        await updateDoc(docRef, { 'status.step': currentStep, 'status.progress': 50 });
        const createdFiles = await fs.readdir(tempDir);
        const segmentNames = ['init.mp4', ...createdFiles.filter(f => f.startsWith('segment_')).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}))];
        
        const kek = Buffer.from(process.env.KEK_SECRET!, 'base64');
        const masterKey = crypto.randomBytes(32);
        const encryptedBasePath = `episodes/${episodeId}/segments/`;
        const processedSegments = [];
        
        for (const fileName of segmentNames) {
            const content = await fs.readFile(path.join(tempDir, fileName));
            const iv = crypto.randomBytes(12);
            const storagePath = `${encryptedBasePath}${fileName.replace('.mp4', '.enc').replace('.m4s', '.m4s.enc')}`;
            
            // Per-segment key derivation is a client-side concern for decryption.
            // Encryption on the server uses the single master key for simplicity and performance.
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
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
        await db.collection('video_keys').doc(keyId).set({ encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'), kekVersion: 1, videoId: episodeId, createdAt: admin.firestore.FieldValue.serverTimestamp() });

        const encryptionInfo = { algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, keyId, kekVersion: 1, aadMode: "path", segmentDurationSec: 4, fragmentEncrypted: true };

        await updateDoc(docRef, {
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath, 'storage.manifestPath': manifestPath,
            'thumbnails.default': defaultThumbUrl, 'thumbnails.defaultPath': defaultThumbStoragePath,
            'thumbnailUrl': after.thumbnails.custom || defaultThumbUrl,
            'encryption': encryptionInfo,
            'status.pipeline': 'completed', 'status.playable': true, 'status.step': 'done', 'status.progress': 100, 'status.error': null,
            'ai.status': 'queued', // Signal for the next function
        });
    } catch (e: any) {
        await failPipeline(docRef, currentStep, e);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
});


// 3. Stage 2 & 3: AI Intelligence and Cleanup Trigger
export const aiAnalysisTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    if (!event.data) return;
    const before = event.data.before.data() as Episode | undefined;
    const after = event.data.after.data() as Episode;

    // Trigger only if the AI status is newly set to 'queued'.
    if (before?.ai?.status === 'queued' && after.ai?.status === 'queued') return;
    if (after.ai?.status !== 'queued') return;
    
    const { id: episodeId, storage: { rawPath } } = after;
    const docRef = event.data.after.ref;

    if (!rawPath) {
        console.error(`[${episodeId}] ❌ AI Stage Failed: rawPath is missing. Cleanup might have run prematurely.`);
        await docRef.update({ 'ai.status': 'failed', 'ai.error': { code: 'RAW_PATH_MISSING', message: 'Original video file path was missing for AI analysis.' } });
        return;
    }
    
    initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile: any = null;

    try {
        await updateDoc(docRef, { 'ai.status': 'processing', 'ai.model': 'gemini-2.5-flash' });
        await bucket.file(rawPath).download({ destination: tempFilePath });
        
        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: 'video/mp4' });
        uploadedFile = uploadResponse.file;
        
        let state = uploadedFile.state;
        while (state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const freshFile = await fileManager.getFile(uploadedFile.name);
            state = freshFile.state;
        }
        if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const prompt = "상세 요약(summary), 타임라인(timeline), 전체 대본(transcript) 뿐만 아니라, AI 검색/채팅을 위한 핵심 키워드(keywords)와 주제(topics)를 JSON으로 추출할 것. 모든 결과는 한국어로 작성되어야 합니다.";
        const result = await model.generateContent([{ fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } }, { text: prompt }]);
        const output = JSON.parse(result.response.text());

        const searchDataPath = `episodes/${episodeId}/ai/search_data.json`;
        await bucket.file(searchDataPath).save(JSON.stringify(output));
        await updateDoc(docRef, { 'ai.status': 'completed', 'ai.resultPaths': { search_data: searchDataPath }, 'ai.error': null });
    } catch (e: any) {
        console.error(`[${episodeId}] ❌ AI Stage Failed.`, e);
        await docRef.update({ 
            'ai.status': 'failed', 
            'ai.error': { code: 'AI_PROCESSING_FAILED', message: e.message || 'Unknown AI error' } 
        });
    } finally {
        if (uploadedFile) { try { await fileManager.deleteFile(uploadedFile.name); } catch (e) {} }
        try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
        // Stage 3: Cleanup raw file regardless of AI success/failure
        await bucket.file(rawPath).delete().catch(e => console.error(`Failed to delete rawPath ${rawPath}`, e));
        await updateDoc(docRef, { 'storage.rawPath': admin.firestore.FieldValue.delete() });
    }
});


// 4. Deletion Trigger
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const episode = event.data?.data() as Episode | undefined;
    
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    
    const prefix = `episodes/${episodeId}/`;
    await bucket.deleteFiles({ prefix }).catch(e => console.error(`Failed to delete files for episode ${episodeId}`, e));
    
    const keyId = episode?.encryption?.keyId;
    if (keyId) {
        await db.collection('video_keys').doc(keyId).delete().catch(e => console.error(`Failed to delete key ${keyId}`, e));
    }
});
