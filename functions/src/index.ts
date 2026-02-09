
/**
 * @fileoverview Video Analysis & Encryption with Gemini using Firebase Cloud Functions v2.
 * This function now performs file-based AES-256-GCM encryption instead of HLS packaging.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

// 0. Firebase Admin & Global Options 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
  minInstances: 1,
  serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();


// 1. MIME Type 도우미
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".avi": return "video/x-msvideo";
    case ".wmv": return "video/x-ms-wmv";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    default: return "video/mp4";
  }
}

// 2. 지연 초기화 (Lazy Initialization)
let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  
  return { genAI, fileManager };
}

// 3. NEW: File-based Encryption (AES-256-GCM)
async function createEncryptedFile(episodeId: string, inputFilePath: string, docRef: admin.firestore.DocumentReference): Promise<void> {
    const tempInputPath = path.join(os.tmpdir(), `original-${episodeId}`);
    const tempOutputPath = path.join(os.tmpdir(), `encrypted-${episodeId}`);

    try {
        console.log(`[${episodeId}] Encryption: Starting download of ${inputFilePath}`);
        await bucket.file(inputFilePath).download({ destination: tempInputPath });
        console.log(`[${episodeId}] Encryption: Download complete.`);

        // 1. Generate master key, salt, and IV
        const masterKey = crypto.randomBytes(32); // 256 bits for AES-256
        const salt = crypto.randomBytes(16);      // 16 bytes salt for HKDF
        const iv = crypto.randomBytes(12);        // 96 bits (12 bytes) is recommended for GCM

        // 2. Create cipher
        const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
        
        // 3. Encrypt using streams to handle large files
        console.log(`[${episodeId}] Encryption: Starting file encryption.`);
        const readStream = fs.createReadStream(tempInputPath);
        const writeStream = fs.createWriteStream(tempOutputPath);
        
        await new Promise<void>((resolve, reject) => {
            readStream.pipe(cipher).pipe(writeStream)
                .on('finish', () => resolve())
                .on('error', reject);
        });
        console.log(`[${episodeId}] Encryption: File encryption finished.`);

        // 4. Get the GCM authentication tag
        const authTag = cipher.getAuthTag();

        // 5. Construct the final encrypted file: [IV][Ciphertext][AuthTag]
        const encryptedData = fs.readFileSync(tempOutputPath);
        const finalBuffer = Buffer.concat([iv, encryptedData, authTag]);

        // 6. Upload the final .lsv file (now private)
        const encryptedStoragePath = `episodes/${episodeId}/encrypted.lsv`;
        console.log(`[${episodeId}] Encryption: Uploading encrypted file to ${encryptedStoragePath}`);
        await bucket.file(encryptedStoragePath).save(finalBuffer, {
            contentType: 'application/octet-stream',
        });
        console.log(`[${episodeId}] Encryption: Upload complete.`);

        // 7. Store the master key and salt securely in `video_keys` collection
        const keyId = `vidkey_${episodeId}`;
        const keyDocRef = db.collection('video_keys').doc(keyId);
        await keyDocRef.set({
            keyId,
            videoId: episodeId,
            masterKey: masterKey.toString('base64'),
            salt: salt.toString('base64'), // Save the salt
            rotation: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${episodeId}] Encryption: Master key and salt saved to video_keys/${keyId}`);

        // 8. Update the episode document with encryption metadata
        await docRef.update({
            'storage.encryptedPath': encryptedStoragePath,
            'storage.fileSize': finalBuffer.length,
            'encryption': {
                algorithm: 'AES-256-GCM',
                keyId: keyId,
                ivLength: iv.length,
                tagLength: authTag.length
            },
            'status.processing': 'completed',
            'status.playable': true,
            'status.error': null,
        });
        console.log(`[${episodeId}] Encryption: Firestore document updated to 'completed' and 'playable'.`);

    } catch (error: any) {
        console.error(`[${episodeId}] File encryption process failed critically. Error:`, error);
        await docRef.update({ 
            'status.processing': "failed",
            'status.playable': false, 
            'status.error': error.message || 'An unknown error occurred during video encryption.' 
        });
    } finally {
        // Clean up temporary files
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    }
}


// ==========================================
// [Trigger] 메인 분석 및 암호화 함수 (v2 onDocumentWritten)
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change) return;

    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted, skipping.`);
      return;
    }
    
    const afterData = change.after.data() as EpisodeData;
    const beforeData = change.before.exists ? change.before.data() as EpisodeData : null;

    if (afterData.aiProcessingStatus !== 'pending' || (beforeData && beforeData.aiProcessingStatus === afterData.aiProcessingStatus)) {
      return;
    }

    const { episodeId } = event.params;
    const docRef = change.after.ref;
    
    console.log(`✨ [${episodeId}] New job detected. Starting AI analysis and Encryption...`);

    await docRef.update({ aiProcessingStatus: "processing", 'status.processing': 'processing' });
    
    const filePath = afterData.filePath;
    if (!filePath) {
      await docRef.update({ 
          aiProcessingStatus: "failed",
          'status.processing': "failed",
          'status.playable': false,
          'status.error': "No filePath found in document.",
          aiProcessingError: "No filePath found in document.",
      });
      return;
    }
    
    const aiAnalysisPromise = runAiAnalysis(episodeId, filePath, docRef);
    const encryptionPromise = createEncryptedFile(episodeId, filePath, docRef);

    try {
        await Promise.allSettled([aiAnalysisPromise, encryptionPromise]);
        
        // After both finish, delete the original raw video file
        console.log(`[${episodeId}] Deleting original source file: ${filePath}`);
        await deleteStorageFileByPath(storage, filePath);
        
        console.log(`✅ [${episodeId}] All jobs (AI & Encryption) have finished execution.`);
    } catch(error: any) {
        console.error(`❌ [${episodeId}] A critical unexpected error occurred in Promise.all. This should not happen.`, error);
    }
});

async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const modelName = "gemini-3-flash-preview";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await localFileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... AI processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

      console.log(`[${episodeId}] Calling Gemini model...`);
      
      const model = localGenAI.getGenerativeModel({ 
        model: modelName, 
        generationConfig: {
          responseMimeType: "application/json",
        }
      }); 

      const prompt = `Analyze this video deeply. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. The output MUST be a JSON object with keys "summary", "transcript", and "timeline". The timeline items must have "startTime", "endTime", "subtitle", and "description". ALL OUTPUT MUST BE IN KOREAN.`;
      
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
        { text: prompt }
      ]);
      
      const rawText = result.response.text();
      let output;
      try {
          // Attempt to find and parse JSON within markdown-style code blocks.
          const jsonMatch = rawText.match(/```(json)?\n([\s\S]*?)\n```/);
          if (jsonMatch && jsonMatch[2]) {
              output = JSON.parse(jsonMatch[2]);
          } else {
              // Fallback to parsing the whole string if no code block is found.
              output = JSON.parse(rawText);
          }
      } catch (jsonError: any) {
          console.error(`[${episodeId}] AI analysis failed: JSON parsing error. Raw output was:`, rawText);
          throw new Error(`JSON parsing failed: ${jsonError.message}.`);
      }
      
      // NEW: Separate transcript from the main content
      const transcriptContent = output.transcript || "";
      delete output.transcript; // Remove large transcript from the object to be stored in Firestore

      const transcriptPath = `episodes/${episodeId}/ai/transcript.txt`;
      await bucket.file(transcriptPath).save(transcriptContent, { contentType: 'text/plain', predefinedAcl: 'publicRead' });
      console.log(`[${episodeId}] Transcript saved to Storage: ${transcriptPath}`);


      let subtitlePath = null;
      if (output.timeline && Array.isArray(output.timeline)) {
        const vttContent = `WEBVTT\n\n${output.timeline
          .map((item: any) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
          .join('\n\n')}`;
        
        const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
        fs.writeFileSync(vttTempPath, vttContent);
        
        subtitlePath = `episodes/${episodeId}/subtitles/subtitle.vtt`;
        
        await bucket.upload(vttTempPath, {
          destination: subtitlePath,
          metadata: { contentType: 'text/vtt', predefinedAcl: 'publicRead' },
        });

        if (fs.existsSync(vttTempPath)) fs.unlinkSync(vttTempPath);
        console.log(`[${episodeId}] VTT subtitle file created.`);
      }

      const analysisJsonString = JSON.stringify(output);
      
      await docRef.update({
        aiProcessingStatus: "completed",
        aiModel: modelName,
        aiGeneratedContent: analysisJsonString,
        subtitlePath: subtitlePath,
        transcriptPath: transcriptPath, // Store path to transcript file
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[${episodeId}] AI analysis succeeded!`);

    } catch (error: any) {
      const detailedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      console.error(`❌ [${episodeId}] AI analysis failed. Detailed error:`, detailedError);
      await docRef.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error),
        aiGeneratedContent: null // Ensure content is cleared on failure
      });
    } finally {
      if (fs.existsSync(tempFilePath) && !filePath.startsWith('/tmp/')) { try { fs.unlinkSync(tempFilePath); } catch (e) {} }
      if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
    }
}

// ==========================================
// [Trigger] 파일 삭제 함수 (v2 onDocumentDeleted)
// ==========================================
export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const deletedData = event.data?.data() as EpisodeData | undefined;

    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);

    // 1. Delete all files in the episode's main storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        console.log(`[DELETE ACTION] Deleting all storage files with prefix: ${prefix}`);
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    
    // 2. Delete the encryption key from `video_keys`
    try {
        const keyId = deletedData?.encryption?.keyId || `vidkey_${episodeId}`;
        const keyRef = db.collection('video_keys').doc(keyId);
        await keyRef.delete();
        console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
    } catch (error) {
        console.error(`[DELETE FAILED] Could not delete encryption key for episode ${episodeId}.`, error);
    }

    // 3. (Optional but good practice) Explicitly delete specific files if paths were stored
    if (deletedData) {
        console.log(`[ADDITIONAL CLEANUP] Using data from deleted doc for explicit cleanup.`);
        await deleteStorageFileByPath(storage, deletedData.filePath); // original file if not already deleted
        await deleteStorageFileByPath(storage, deletedData.defaultThumbnailPath);
        await deleteStorageFileByPath(storage, deletedData.customThumbnailPath);
    }
    
    console.log(`[DELETE FINISHED] Cleanup process finished for episode ${episodeId}.`);
});

const deleteStorageFileByPath = async (storage: admin.storage.Storage, filePath: string | undefined) => {
    if (!filePath) {
        // console.warn(`[SKIP DELETE] No file path provided.`);
        return;
    }
    try {
        const file = storage.bucket().file(filePath);
        const [exists] = await file.exists();
        if (exists) {
            console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
            await file.delete();
            console.log(`[DELETE SUCCESS] File deleted: ${filePath}`);
        } else {
            // console.log(`[SKIP DELETE] File does not exist, skipping deletion: ${filePath}`);
        }
    } catch (error: any) {
        if (error.code === 404) {
             // console.log(`[SKIP DELETE] File not found during cleanup, which is acceptable: ${filePath}`);
             return;
        }
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};

interface EpisodeData {
  filePath?: string;
  courseId: string;
  aiProcessingStatus?: string;
  defaultThumbnailPath?: string;
  customThumbnailPath?: string;
  encryption?: { keyId?: string };
  [key: string]: any;
}
