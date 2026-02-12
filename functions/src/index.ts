
/**
 * @fileoverview Video Analysis & Encryption Pipeline (v6 - fMP4 Segment-based)
 * This version transcodes videos into fragmented MP4, splits them into segments,
 * and encrypts each segment individually for secure, efficient streaming.
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

// Minimal Episode type definition for Cloud Function context
interface Episode {
  filePath?: string;
  status?: {
    processing: 'pending' | 'processing' | 'completed' | 'failed';
    [key: string]: any;
  };
  encryption?: {
    keyId: string;
  };
  aiProcessingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  aiProcessingError?: string | null;
  [key: string]: any;
}


// 0. Firebase Admin, FFMpeg, & Global Options 초기화
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}
ffmpeg.setFfprobePath(ffprobePath);

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY", "KEK_SECRET"],
  timeoutSeconds: 540, // Increased timeout for video processing
  memory: "4GiB",     // Increased memory for ffmpeg
  cpu: 2,             // Increased CPU for ffmpeg
  minInstances: 0,
  serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// --- Utility Functions ---

function getMimeType(filePath: string): string {
    return "video/mp4"; // All outputs are now MP4
}

let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;
let cachedKEK: Buffer | null = null;

function validateKEK(key: Buffer): void {
    if (key.length !== 32) {
        throw new Error(`Invalid KEK format. Expected 32-byte key, received ${key.length} bytes.`);
    }
}

async function loadKEK(): Promise<Buffer> {
    if (cachedKEK) return cachedKEK;
    const kekSecret = process.env.KEK_SECRET;
    if (!kekSecret) throw new Error("CRITICAL: KEK_SECRET is not configured.");
    const key = Buffer.from(kekSecret, 'base64');
    validateKEK(key);
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


// ==========================================
// NEW: Video Processing Pipeline (fMP4)
// ==========================================

async function processAndEncryptVideo(episodeId: string, inputFilePath: string, docRef: admin.firestore.DocumentReference): Promise<void> {
    const DEBUG = true; // 강제 디버그 모드
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
        await new Promise<void>((resolve, reject) => {
            ffmpeg(localInputPath)
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
                .on('start', (commandLine) => {
                    if (DEBUG) console.log(`[${episodeId}] 🚀 FFMPEG TRANSCODE COMMAND: ${commandLine}`);
                })
                .on('error', (err) => reject(new Error(`ffmpeg transcoding failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(fragmentedMp4Path);
        });
        console.log(`[${episodeId}] ✅ Pass 1: Transcoding complete.`);
        
        // 3. Probe the generated fMP4 to get accurate codec info
        console.log(`[${episodeId}] Probing generated fMP4 for codec info...`);
        const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(fragmentedMp4Path, (err, data) => {
                if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
                resolve(data);
            });
        });

        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;

        if (!videoStream) throw new Error("No video stream found in the generated fMP4 file.");

        const codecString = `video/mp4; codecs="${videoStream.codec_tag_string}, ${audioStream?.codec_tag_string || 'mp4a.40.2'}"`;
        if (DEBUG) console.log(`[${episodeId}] 💡 Detected Codec String:`, codecString);

        // 4. Split the fMP4 file into DASH segments (Correct method for MSE)
        console.log(`[${episodeId}] Pass 2: Splitting into DASH segments...`);
        const mediaSegmentPattern = 'segment_%d.m4s';
        await new Promise<void>((resolve, reject) => {
            ffmpeg(fragmentedMp4Path)
                .outputOptions([
                    '-c copy',
                    '-f dash',
                    '-seg_duration 4',
                    '-init_seg_name init.mp4',
                    `-media_seg_name ${mediaSegmentPattern}`,
                ])
                .on('start', (commandLine) => {
                    if (DEBUG) console.log(`[${episodeId}] 🚀 FFMPEG DASH SEGMENT COMMAND: ${commandLine}`);
                })
                .on('error', (err) => reject(new Error(`ffmpeg DASH segmentation failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(path.join(tempOutputDir, 'manifest.mpd')); // output is an mpd, which we ignore
        });
        console.log(`[${episodeId}] ✅ Pass 2: DASH segmentation complete.`);


        // 5. Analyze segment files and prepare for encryption
        if (DEBUG) console.log(`[${episodeId}] 📂 DASH output dir:`, tempOutputDir);
        const createdFiles = await fs.readdir(tempOutputDir);
        if (DEBUG) console.log(`[${episodeId}] 🔎 DASH segment file structure analysis:`, createdFiles);
        
        if (!createdFiles.includes("init.mp4")) {
            throw new Error(`[${episodeId}] ❌ init.mp4 NOT FOUND`);
        }
        
        const mediaSegmentNames = createdFiles
            .filter(f => f.startsWith('segment_') && f.endsWith('.m4s'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/(\d+)/)?.[0] || '0');
                const numB = parseInt(b.match(/(\d+)/)?.[0] || '0');
                return numA - numB;
            });
            
        if (DEBUG) console.log(`[${episodeId}] 📊 Segment count:`, mediaSegmentNames.length);
        if (mediaSegmentNames.length === 0) {
            throw new Error(`[${episodeId}] ❌ NO MEDIA SEGMENTS CREATED`);
        }

        const allSegmentsToProcess = ['init.mp4', ...mediaSegmentNames];

        // 6. Encrypt and Upload Segments
        console.log(`[${episodeId}] Encrypting and uploading segments...`);
        const { getKek } = initializeTools();
        const kek = await getKek();
        const masterKey = crypto.randomBytes(32);
        
        const manifest = {
            codec: codecString,
            duration: Math.round(duration),
            segmentDuration: 4,
            segmentCount: mediaSegmentNames.length,
            init: `episodes/${episodeId}/segments/init.enc`,
            segments: [] as { path: string }[],
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

            if (DEBUG) {
                console.log(`[${episodeId}] 📦 Segment '${fileName}' | Original Size: ${content.length} -> Encrypted Size: ${finalBuffer.length}`);
                if (finalBuffer.length !== content.length + 28) {
                    throw new Error(`[${episodeId}] ❌ Encryption size mismatch for ${fileName}. Expected ${content.length + 28}, but got ${finalBuffer.length}.`);
                }
            }
            
            let outputFileName: string;
            if (fileName === 'init.mp4') {
                outputFileName = 'init.enc';
            } else {
                outputFileName = fileName.replace('.m4s', '.m4s.enc');
            }
            const storagePath = `episodes/${episodeId}/segments/${outputFileName}`;

            await bucket.file(storagePath).save(finalBuffer, { contentType: 'application/octet-stream' });
            
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
        if (DEBUG) console.log(`[${episodeId}] 🧾 Manifest content:`, JSON.stringify(manifest, null, 2));
        await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), {
            contentType: 'application/json',
        });
        
        // 9. Update Firestore document with encryption metadata
        const encryptionInfo = {
            algorithm: 'AES-256-GCM',
            ivLength: 12,
            tagLength: 16,
            keyId: keyId,
            fragmentEncrypted: true,
        };

        await docRef.update({
            duration: Math.round(duration),
            codec: manifest.codec,
            manifestPath: manifestPath,
            encryption: encryptionInfo,
            'storage.fileSize': totalEncryptedSize,
            'status.processing': 'completed',
            'status.playable': true,
            'status.error': null,
        });

        console.log(`[${episodeId}] ✅ Processing complete. Manifest created at ${manifestPath}`);

    } catch (error: any) {
        console.error(`[${episodeId}] ❌ Video processing failed:`, error);
        await docRef.update({
            'status.processing': "failed",
            'status.playable': false,
            'status.error': error.message || 'An unknown error occurred during video processing.'
        });
    } finally {
        await fs.rm(tempInputDir, { recursive: true, force: true });
        await fs.rm(tempOutputDir, { recursive: true, force: true });
        console.log(`[${episodeId}] Cleaned up temporary files.`);
    }
}


// ==========================================
// Cloud Function Triggers
// ==========================================

export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists) return;
    
    const afterData = change.after.data() as Episode;
    const beforeData = change.before.exists ? change.before.data() as Episode : null;

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


export async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const modelName = "gemini-1.5-flash-latest";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), `ai-in-${episodeId}`);
    let uploadedFile: any = null;

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      const uploadResponse = await localFileManager.uploadFile(tempFilePath, { mimeType: getMimeType(filePath), displayName: episodeId });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const freshFile = await localFileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... AI processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

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
      } catch (jsonError: any) {
          console.error(`[${episodeId}] AI JSON parsing error. Raw output:`, rawText);
          throw new Error(`JSON 파싱 실패: ${jsonError.message}.`);
      }
      
      const transcriptPath = `episodes/${episodeId}/ai/transcript.txt`;
      await bucket.file(transcriptPath).save(output.transcript || "", { contentType: 'text/plain' });

      let subtitlePath: string | null = null;
      if (output.timeline && Array.isArray(output.timeline) && output.timeline.length > 0) {
        const vttContent = `WEBVTT\n\n${output.timeline
            .map((item: any) => {
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

    } catch (error: any) {
      console.error(`❌ [${episodeId}] AI analysis failed.`, error);
      await docRef.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error),
      });
    } finally {
      if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
      try { await fs.rm(tempFilePath, { force: true }); } catch (e) {}
    }
}


export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    
    const prefix = `episodes/${episodeId}/`;
    try {
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    
    try {
        const keyId = event.data?.data()?.encryption?.keyId || `vidkey_${episodeId}`;
        await db.collection('video_keys').doc(keyId).delete();
        console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete encryption key for episode ${episodeId}.`, error);
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

    

    