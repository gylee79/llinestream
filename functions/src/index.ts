
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
import type { Episode, EncryptionInfo } from './lib/types';

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

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is not configured.");
  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager };
}

async function updateDoc(docRef: admin.firestore.DocumentReference, data: object) {
    await docRef.update(data);
}

// 2. Pipeline Stage Implementations
async function runVideoCoreStage(docRef: admin.firestore.DocumentReference, episode: Episode) {
    const { id: episodeId, storage: { rawPath } } = episode;
    if (!rawPath) throw new Error("rawPath is missing");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-${episodeId}-`));
    const localInputPath = path.join(tempDir, 'original_video');
    const fragmentedMp4Path = path.join(tempDir, 'frag.mp4');
    const defaultThumbnailPath = path.join(tempDir, 'default_thumb.jpg');

    try {
        await bucket.file(rawPath).download({ destination: localInputPath });

        await updateDoc(docRef, { 'status.step': 'transcode', 'status.progress': 15 });

        const probeData = await new Promise<ffmpeg.FfprobeData>((res, rej) => ffmpeg.ffprobe(localInputPath, (err, data) => err ? rej(err) : res(data)));
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;

        // --- Thumbnail Generation ---
        await new Promise<void>((res, rej) => {
            ffmpeg(localInputPath)
                .seekInput(duration / 2)
                .frames(1)
                .output(defaultThumbnailPath)
                .on('error', rej)
                .on('end', () => res())
                .run();
        });
        const defaultThumbStoragePath = `episodes/${episodeId}/thumbnails/default.jpg`;
        await bucket.upload(defaultThumbnailPath, { destination: defaultThumbStoragePath });
        const defaultThumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(defaultThumbStoragePath)}?alt=media`;

        await new Promise<void>((res, rej) => {
            const command = ffmpeg(localInputPath).videoCodec('libx264').outputOptions(['-vf', 'scale=-2:1080']);
            if (audioStream) command.audioCodec('aac');
            command.outputOptions(['-profile:v baseline', '-level 3.0', '-pix_fmt yuv420p', '-g 48', '-keyint_min 48', '-sc_threshold 0', '-movflags frag_keyframe+empty_moov'])
                .toFormat('mp4').on('error', rej).on('end', () => res()).save(fragmentedMp4Path);
        });

        await new Promise<void>((res, rej) => {
            ffmpeg(fragmentedMp4Path).outputOptions(['-f dash', `-seg_duration ${SEGMENT_DURATION_SEC}`, '-init_seg_name init.mp4', `-media_seg_name segment_%d.m4s`])
                .on('error', rej).on('end', () => res()).save(path.join(tempDir, 'manifest.mpd'));
        });

        await updateDoc(docRef, { 'status.step': 'encrypt', 'status.progress': 40 });
        const createdFiles = await fs.readdir(tempDir);
        const segmentNames = ['init.mp4', ...createdFiles.filter(f => f.startsWith('segment_')).sort()];
        
        const kek = Buffer.from(process.env.KEK_SECRET!, 'base64');
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

        await updateDoc(docRef, { 'status.step': 'manifest', 'status.progress': 85 });
        const manifestPath = `episodes/${episodeId}/manifest.json`;
        const manifest = {
            codec: audioStream ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` : `video/mp4; codecs="avc1.42E01E"`,
            duration: Math.round(duration),
            init: processedSegments.find(s => s.name === 'init.mp4')?.path,
            segments: processedSegments.filter(s => s.name !== 'init.mp4').map(s => ({ path: s.path })),
        };
        await bucket.file(manifestPath).save(JSON.stringify(manifest));

        const keyId = `vidkey_${episodeId}`;
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', kek, kekIv);
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, kekCipher.update(masterKey), kekCipher.final(), kekCipher.getAuthTag()]);
        await db.collection('video_keys').doc(keyId).set({ encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'), kekVersion: 1 });
        
        const encryptionInfo: EncryptionInfo = {
            algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, keyId, kekVersion: 1, aadMode: "path", segmentDurationSec: 4, fragmentEncrypted: true
        };

        await updateDoc(docRef, {
            duration: Math.round(duration),
            'storage.encryptedBasePath': encryptedBasePath, 'storage.manifestPath': manifestPath,
            'thumbnails.default': defaultThumbUrl, 'thumbnails.defaultPath': defaultThumbStoragePath,
            'thumbnailUrl': episode.thumbnails.custom || defaultThumbUrl,
            'encryption': encryptionInfo,
            'status.pipeline': 'completed', 'status.playable': true, 'status.step': 'done', 'status.progress': 100, 'status.error': null,
            'ai.status': 'queued',
        });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function runAiStage(docRef: admin.firestore.DocumentReference, episode: Episode) {
    const { id: episodeId, storage: { rawPath } } = episode;
    if (!rawPath) throw new Error("AI analysis requires rawPath, but it was missing.");
    
    initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-${episodeId}`);
    let uploadedFile: any = null;

    try {
        await updateDoc(docRef, { 'ai.status': 'processing', 'ai.model': 'gemini-2.5-flash' });

        await bucket.file(rawPath).download({ destination: tempFilePath });
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

        await updateDoc(docRef, { 'ai.status': 'completed', 'ai.resultPaths': { search_data: searchDataPath }, 'ai.error': null });
    } finally {
        if (uploadedFile) {
            try { await fileManager!.deleteFile(uploadedFile.name); } catch (e) {}
        }
        try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
    }
}

async function runCleanupStage(docRef: admin.firestore.DocumentReference, episode: Episode) {
    if (episode.storage.rawPath) {
        await bucket.file(episode.storage.rawPath).delete().catch(e => console.error(`Failed to delete rawPath ${episode.storage.rawPath}`, e));
        await updateDoc(docRef, { 'storage.rawPath': admin.firestore.FieldValue.delete() });
    }
}

// 3. Main Orchestrator Trigger
export const episodeProcessingTrigger = onDocumentWritten("episodes/{episodeId}", async (event) => {
    if (!event.data) return;
    
    const docRef = event.data.after.ref;
    const after = event.data.after.data() as Episode;
    const before = event.data.before?.data() as Episode | undefined;

    // Loop Prevention
    if (before && after.status?.pipeline === before.status?.pipeline && after.ai?.status === before.ai?.status) {
        return;
    }

    try {
        // Stage 0: Validation & Stage 1: Video Core
        if (after.status.pipeline === 'pending') {
            await updateDoc(docRef, { 'status.pipeline': 'processing', 'status.step': 'validate', 'status.progress': 5, 'status.playable': false, 'status.error': null });
            if (!after.storage?.rawPath || !(await bucket.file(after.storage.rawPath).exists())[0]) {
                throw { step: 'validate', error: new Error("RawPath Missing or file does not exist.") };
            }
            await runVideoCoreStage(docRef, after);
        }
        // Stage 2: AI Intelligence
        else if (after.ai?.status === 'queued') {
            await runAiStage(docRef, after);
        }
        // Stage 3: Cleanup
        else if (before && (after.ai?.status === 'completed' || after.ai?.status === 'failed') && after.ai?.status !== before.ai?.status) {
            await runCleanupStage(docRef, after);
        }
    } catch (e: any) {
        await updateDoc(docRef, {
            'status.pipeline': 'failed',
            'status.playable': (e.step === 'ai_intelligence' || e.step === 'cleanup') ? after.status.playable : false,
            'status.error': { step: e.step || 'trigger-exception', message: e.message || 'Unknown error', ts: admin.firestore.FieldValue.serverTimestamp() },
            ...(e.step === 'ai_intelligence' && { 'ai.status': 'failed', 'ai.error': { code: 'AI_PROCESSING_FAILED', message: e.message || 'Unknown AI error', ts: admin.firestore.FieldValue.serverTimestamp() } }),
        });
    }
});

export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const prefix = `episodes/${event.params.episodeId}/`;
    await bucket.deleteFiles({ prefix }).catch(e => console.error(`Failed to delete files for episode ${event.params.episodeId}`, e));
    const keyId = event.data?.data().encryption?.keyId;
    if (keyId) {
        await db.collection('video_keys').doc(keyId).delete().catch(e => console.error(`Failed to delete key ${keyId}`, e));
    }
});
