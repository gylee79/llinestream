
/**
 * @fileoverview Video processing workflow using Cloud Functions v2.
 * This function handles AI analysis and file-based encryption (AES-256-GCM).
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

// 0. Firebase Admin & Global Options Initialization
if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
  serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// 1. MIME Type Helper
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

// 2. Lazy Initialization for AI tools
let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;

function initializeAITools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  
  return { genAI, fileManager };
}

// 3. File-based Encryption Function (AES-256-GCM)
async function encryptVideo(episodeId: string, inputFilePath: string, docRef: admin.firestore.DocumentReference): Promise<void> {
    const localInputPath = path.join(os.tmpdir(), `original-${episodeId}.mp4`);
    const localOutputPath = path.join(os.tmpdir(), `encrypted-${episodeId}.lsv`);

    try {
        console.log(`[Encrypt] Starting encryption for episode ${episodeId}.`);
        await docRef.update({ 'status.processing': 'processing', 'status.error': null });

        // 1. Download original video
        await bucket.file(inputFilePath).download({ destination: localInputPath });

        // 2. Generate encryption key and IV
        const masterKey = crypto.randomBytes(32); // 256-bit key
        const iv = crypto.randomBytes(12); // 96-bit IV for GCM
        const algorithm = 'aes-256-gcm';
        
        const cipher = crypto.createCipheriv(algorithm, masterKey, iv);
        
        // 3. Create streams for encryption
        const readStream = fs.createReadStream(localInputPath);
        const writeStream = fs.createWriteStream(localOutputPath);
        
        // 4. Encrypt the video file
        await new Promise<void>((resolve, reject) => {
            readStream.pipe(cipher).pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            cipher.on('error', reject);
            readStream.on('error', reject);
        });

        const authTag = cipher.getAuthTag();

        // 5. Assemble the final encrypted file: IV + Encrypted Data + Auth Tag
        const ivBuffer = iv;
        const encryptedDataBuffer = fs.readFileSync(localOutputPath);
        const finalEncryptedBuffer = Buffer.concat([ivBuffer, encryptedDataBuffer, authTag]);

        // 6. Upload encrypted file to Storage
        const encryptedStoragePath = `episodes/${episodeId}/encrypted.lsv`;
        const encryptedFile = bucket.file(encryptedStoragePath);
        await encryptedFile.save(finalEncryptedBuffer, {
            contentType: 'application/octet-stream',
            predefinedAcl: 'publicRead' // Encrypted file can be public, key is secret
        });

        // 7. Securely store the master key in Firestore `video_keys` collection
        const keyId = `vidkey_${episodeId}`;
        const keyRef = db.collection('video_keys').doc(keyId);
        await keyRef.set({
            keyId,
            videoId: episodeId,
            masterKey: masterKey.toString('base64'),
            rotation: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 8. Update episode document with encryption metadata
        await docRef.update({
            'encryption.algorithm': 'AES-256-GCM',
            'encryption.keyId': keyId,
            'encryption.ivLength': iv.length,
            'encryption.tagLength': authTag.length,
            'storage.encryptedPath': encryptedStoragePath,
            'status.processing': 'completed',
            'status.playable': true
        });

        console.log(`[Encrypt] Successfully encrypted and stored video for ${episodeId}.`);

    } catch (error: any) {
        console.error(`[Encrypt] Failed for episode ${episodeId}. Error:`, error);
        await docRef.update({
            'status.processing': 'failed',
            'status.playable': false,
            'status.error': error.message || 'An unknown encryption error occurred.'
        });
    } finally {
        // Cleanup local files
        if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
        if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
    }
}


// ==========================================
// Main Trigger Function (v2 onDocumentWritten)
// ==========================================
export const processUploadedVideo = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change) return;

    if (!change.after.exists) {
      console.log(`[Trigger] Document ${event.params.episodeId} deleted, skipping processing.`);
      return;
    }
    
    const afterData = change.after.data() as any; // Using `any` for easier access to nested props
    const beforeData = change.before.exists ? change.before.data() as any : null;

    if (afterData.status?.processing !== 'pending' || (beforeData && beforeData.status?.processing === afterData.status?.processing)) {
      return;
    }

    const { episodeId } = event.params;
    const docRef = change.after.ref;
    
    console.log(`✨ [Trigger] New job for ${episodeId}. Starting...`);
    await docRef.update({ 'status.processing': "processing", 'status.error': null });
    
    const filePath = afterData.filePath;
    if (!filePath) {
      await docRef.update({ 
          'status.processing': "failed", 
          'status.playable': false,
          'status.error': "No original 'filePath' found in document."
      });
      return;
    }
    
    // We can run AI Analysis and Encryption in parallel.
    const aiAnalysisPromise = runAiAnalysis(episodeId, filePath, docRef);
    const encryptionPromise = encryptVideo(episodeId, filePath, docRef);

    try {
        await Promise.allSettled([aiAnalysisPromise, encryptionPromise]);
        console.log(`✅ [Trigger] All jobs (AI & Encryption) have finished for ${episodeId}.`);
    } catch(error: any) {
        console.error(`❌ [Trigger] Critical unexpected error in Promise.all for ${episodeId}.`, error);
    }
});

async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const modelName = "gemini-2.5-flash";
    console.log(`🚀 [AI] Processing started for ${episodeId} (Model: ${modelName}).`);
    
    const { genAI: localGenAI, fileManager: localFileManager } = initializeAITools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;

    try {
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[AI] Uploaded to Google AI: ${uploadedFile.uri}`);

      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await localFileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`[AI] ... processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI file processing failed.");

      console.log(`[AI] Calling Gemini model for ${episodeId}...`);
      
      const model = localGenAI.getGenerativeModel({ 
        model: modelName, 
        generationConfig: { responseMimeType: "application/json" }
      }); 

      const prompt = `Analyze this video deeply. Provide a detailed summary, a full transcript, and a timeline of key events with subtitles and descriptions. The output MUST be a JSON object with keys "summary", "transcript", and "timeline". The timeline items must have "startTime", "endTime", "subtitle", and "description". ALL OUTPUT MUST BE IN KOREAN.`;
      
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
        { text: prompt }
      ]);

      const output = JSON.parse(result.response.text());
      const analysisJsonString = JSON.stringify(output);

      // Create and upload VTT file
      let vttPath: string | null = null;
      if (output.timeline && Array.isArray(output.timeline)) {
        const vttContent = `WEBVTT\n\n${output.timeline
          .map((item: any) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
          .join('\n\n')}`;
        
        const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
        fs.writeFileSync(vttTempPath, vttContent);
        
        vttPath = `episodes/${episodeId}/subtitle.vtt`;
        await bucket.upload(vttTempPath, { destination: vttPath, metadata: { contentType: 'text/vtt' } });

        if (fs.existsSync(vttTempPath)) fs.unlinkSync(vttTempPath);
        console.log(`[AI] VTT subtitle file created for ${episodeId}.`);
      }

      // Update Firestore with AI results
      await docRef.update({
        aiGeneratedContent: analysisJsonString,
        subtitlePath: vttPath,
      });

      console.log(`[AI] Analysis succeeded for ${episodeId}!`);

    } catch (error: any) {
      console.error(`❌ [AI] Analysis failed for ${episodeId}.`, error);
      // We log the error but don't change the main processing status,
      // as encryption might still succeed. The UI can show a specific AI error.
      await docRef.update({
        'status.error': `AI Analysis Failed: ${error.message || String(error)}`
      });
    } finally {
      if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch (e) {} }
      if (uploadedFile) { try { await localFileManager.deleteFile(uploadedFile.name); } catch (e) {} }
    }
}

// ==========================================
// Cleanup Trigger (v2 onDocumentDeleted)
// ==========================================
export const deleteEpisodeFiles = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const deletedData = event.data?.data() as any;

    console.log(`[DELETE] Cleanup trigger for episode ${episodeId}.`);

    // 1. Delete all files in the episode's storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        console.log(`[DELETE] Deleting all files with prefix: ${prefix}`);
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE] All storage files for episode ${episodeId} deleted.`);
    } catch (error) {
        console.error(`[DELETE] Could not delete storage files for episode ${episodeId}.`, error);
    }
    
    // 2. Delete the encryption key
    if (deletedData?.encryption?.keyId) {
        try {
            const keyRef = db.collection('video_keys').doc(deletedData.encryption.keyId);
            await keyRef.delete();
            console.log(`[DELETE] Encryption key ${deletedData.encryption.keyId} deleted.`);
        } catch (error) {
            console.error(`[DELETE] Could not delete encryption key for episode ${episodeId}.`, error);
        }
    }

    // 3. Delete the original uploaded file if path exists (redundant but safe)
     if (deletedData?.filePath) {
        try {
            await bucket.file(deletedData.filePath).delete();
        } catch (error: any) {
            if (error.code !== 404) console.error(`[DELETE] Failed to delete original file at ${deletedData.filePath}`, error);
        }
    }
    
    console.log(`[DELETE] Cleanup process finished for episode ${episodeId}.`);
});
