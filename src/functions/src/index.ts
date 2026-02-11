
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
import { path as ffprobePath } from 'ffprobe-static';

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
  timeoutSeconds: 900, // Increased timeout for video processing
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
    const tempInputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-in-${episodeId}-`));
    const tempOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), `lline-out-${episodeId}-`));
    const localInputPath = path.join(tempInputDir, 'original_video');

    try {
        // 1. Download source video
        console.log(`[${episodeId}] Downloading source: ${inputFilePath}`);
        await bucket.file(inputFilePath).download({ destination: localInputPath });

        // 2. Probe for codec and duration info
        console.log(`[${episodeId}] Probing video file...`);
        const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(localInputPath, (err, data) => {
                if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
                resolve(data);
            });
        });

        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
        const duration = probeData.format.duration || 0;

        if (!videoStream) throw new Error("No video stream found in the input file.");

        // 3. Transcode to fragmented MP4
        const fragmentedMp4Path = path.join(tempInputDir, 'frag.mp4');
        await new Promise<void>((resolve, reject) => {
            ffmpeg(localInputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .audioBitrate('128k')
                .videoBitrate('2000k')
                .outputOptions([
                    '-profile:v baseline', // Changed from high to baseline for max compatibility
                    '-level 3.0',
                    '-pix_fmt yuv420p',
                    '-movflags frag_keyframe+empty_moov'
                ])
                .toFormat('mp4')
                .on('start', (commandLine) => console.log(`[${episodeId}] 🚀 FFMPEG TRANSCODE COMMAND: ${commandLine}`))
                .on('error', (err) => reject(new Error(`ffmpeg transcoding failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(fragmentedMp4Path);
        });
        console.log(`[${episodeId}] ✅ Transcoding to fragmented MP4 successful.`);

        // 4. Split into init and media segments
        const segmentPattern = 'segment_%04d.mp4';
        await new Promise<void>((resolve, reject) => {
            ffmpeg(fragmentedMp4Path)
                .outputOptions([
                    '-c copy',
                    '-f segment',
                    '-segment_time 4', // 4-second segments
                    '-reset_timestamps 1'
                ])
                .on('start', (commandLine) => console.log(`[${episodeId}] 🚀 FFMPEG SEGMENT COMMAND: ${commandLine}`))
                .on('error', (err) => reject(new Error(`ffmpeg segmentation failed: ${err.message}`)))
                .on('end', () => resolve())
                .save(path.join(tempOutputDir, segmentPattern));
        });

        // 5. DEBUG: Log created segment files
        const createdFiles = await fs.readdir(tempOutputDir);
        console.log(`[${episodeId}] 🔎 Segment file structure analysis:`, createdFiles);
        
        // Find init segment (ffmpeg names it like other segments, usually the first)
        const initSegmentName = createdFiles.find(f => f.startsWith('segment_'));
        if (!initSegmentName) throw new Error("Init segment not found after ffmpeg processing.");
        console.log(`[${episodeId}] ✅ Init segment found: ${initSegmentName}`);
        
        const initSegmentPath = path.join(tempOutputDir, initSegmentName);
        const finalInitSegmentName = 'init.mp4';
        await fs.rename(initSegmentPath, path.join(tempOutputDir, finalInitSegmentName));
        console.log(`[${episodeId}] ✅ Renamed ${initSegmentName} to ${finalInitSegmentName}.`);

        const mediaSegmentNames = createdFiles.filter(f => f !== initSegmentName).sort();
        const allSegmentsToProcess = [finalInitSegmentName, ...mediaSegmentNames];
        
        // 6. Encrypt and Upload Segments
        console.log(`[${episodeId}] Encrypting and uploading segments...`);
        const { getKek } = initializeTools();
        const kek = await getKek();
        const masterKey = crypto.randomBytes(32);
        
        const codecString = videoStream.codec_tag_string === 'avc1'
            ? `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` // Correct for Baseline Profile Level 3.0
            : `video/mp4; codecs="${videoStream.codec_tag_string}, ${audioStream?.codec_tag_string || 'mp4a.40.2'}"`;

        const manifest = {
            codec: codecString,
            init: `episodes/${episodeId}/init.enc`,
            segments: [] as { path: string }[],
        };
        
        let totalEncryptedSize = 0;

        for (const [index, fileName] of allSegmentsToProcess.entries()) {
            const localFilePath = path.join(tempOutputDir, fileName);
            const content = await fs.readFile(localFilePath);
            
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            
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
            codec: manifest.codec, // Store the determined codec
            manifestPath: manifestPath,
            keyId: keyId, // Store keyId on episode doc for easy lookup
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
        // Clean up temporary directories
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

    // Trigger only on creation or manual reset of the main processing status
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
    
    // Run tasks sequentially to avoid resource contention
    await processAndEncryptVideo(episodeId, filePath, docRef);
    await runAiAnalysis(episodeId, filePath, docRef);

    console.log(`[${episodeId}] Deleting original source file: ${filePath}`);
    await deleteStorageFileByPath(filePath);
    console.log(`✅ [${episodeId}] All jobs finished.`);
});


// This remains largely the same
export async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const modelName = "gemini-1.5-flash-latest"; // Using the latest model
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

      // Create and save VTT content
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
        subtitlePath: subtitlePath, // Save VTT path
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
    
    // Delete all files in the episode's storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    
    // Delete the encryption key
    try {
        const keyId = event.data?.data()?.keyId || `vidkey_${episodeId}`;
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
        // Log but don't throw, as cleanup failure shouldn't fail the whole process
        console.error(`Could not delete storage file at path ${filePath}.`, error);
    }
};
