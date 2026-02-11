"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFilesOnEpisodeDelete = exports.analyzeVideoOnWrite = void 0;
/**
 * @fileoverview Video Analysis & Encryption with Gemini using Firebase Cloud Functions v2.
 * This function now performs file-based AES-256-GCM encryption instead of HLS packaging.
 */
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
// 0. Firebase Admin & Global Options 초기화
if (!admin.apps.length) {
    admin.initializeApp();
}
// KEK_SECRET is injected via Secret Manager in production.
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: [
        "GOOGLE_GENAI_API_KEY",
        "KEK_SECRET"
    ],
    timeoutSeconds: 540,
    memory: "2GiB",
    minInstances: 0,
    serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();
// 1. MIME Type 도우미
function getMimeType(filePath) {
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
// 2. 지연 초기화 및 KEK 로딩 로직
let genAI = null;
let fileManager = null;
let cachedKEK = null;
function validateKEK(key) {
    if (key.length !== 32) {
        // Log the incorrect length for debugging, but not the key itself.
        const errorMessage = `Invalid KEK format. Expected a 32-byte key, but received ${key.length} bytes after Base64 decoding.`;
        console.error(`CRITICAL: ${errorMessage}`);
        throw new Error(errorMessage);
    }
}
async function loadKEK() {
    if (cachedKEK) {
        return cachedKEK;
    }
    // For deployed functions, use the secret from Secret Manager injected as an env var.
    const kekSecret = process.env.KEK_SECRET;
    if (kekSecret) {
        console.log("KEK_SECRET found in environment. Loading and validating key.");
        const key = Buffer.from(kekSecret, 'base64');
        validateKEK(key); // 유효성 검사 실패 시 여기서 에러 발생
        cachedKEK = key;
        return cachedKEK;
    }
    // KEK가 어떤 소스에서도 발견되지 않으면, 함수를 중지시키기 위해 치명적 오류 발생
    console.error("CRITICAL: KEK_SECRET is not configured in the function's environment or via Secret Manager.");
    throw new Error("KEK_SECRET is not configured. Function cannot proceed.");
}
function initializeTools() {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
        throw new Error("GOOGLE_GENAI_API_KEY is missing!");
    if (!genAI)
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    if (!fileManager)
        fileManager = new server_1.GoogleAIFileManager(apiKey);
    return {
        genAI,
        fileManager,
        getKek: loadKEK // KEK 로더 함수 반환
    };
}
// 3. NEW: Chunked AES-256-GCM Encryption with Length Header
async function createEncryptedFile(episodeId, inputFilePath, docRef) {
    const tempInputPath = path.join(os.tmpdir(), `original-${episodeId}`);
    const tempOutputPath = path.join(os.tmpdir(), `encrypted-${episodeId}`);
    try {
        const { getKek } = initializeTools();
        const localKek = await getKek();
        console.log(`[${episodeId}] Encryption: Starting download of ${inputFilePath}`);
        await bucket.file(inputFilePath).download({ destination: tempInputPath });
        console.log(`[${episodeId}] Encryption: Download complete.`);
        // 1. Generate master key and salt
        const masterKey = crypto.randomBytes(32); // 256 bits for AES-256
        const salt = crypto.randomBytes(16); // 16 bytes salt for HKDF
        // 2. Encrypt the file in chunks
        console.log(`[${episodeId}] Encryption: Starting chunked file encryption (v3 format).`);
        const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB plaintext chunks
        const readStream = fs.createReadStream(tempInputPath, { highWaterMark: CHUNK_SIZE });
        const writeStream = fs.createWriteStream(tempOutputPath);
        let chunkIndex = 0;
        for await (const chunk of readStream) {
            const iv = crypto.randomBytes(12); // New IV for each chunk
            const aad = Buffer.from(`chunk-index:${chunkIndex++}`); // AAD for replay/reorder protection
            const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
            cipher.setAAD(aad);
            const encryptedChunk = Buffer.concat([cipher.update(chunk), cipher.final()]);
            const authTag = cipher.getAuthTag();
            const chunkBodyLength = iv.length + encryptedChunk.length + authTag.length;
            const lengthBuffer = Buffer.alloc(4);
            lengthBuffer.writeUInt32BE(chunkBodyLength, 0);
            // Write [ChunkLength(4)][IV (12)][Ciphertext (chunk size)][AuthTag (16)]
            writeStream.write(lengthBuffer);
            writeStream.write(iv);
            writeStream.write(encryptedChunk);
            writeStream.write(authTag);
        }
        await new Promise((resolve) => {
            writeStream.end(resolve);
        });
        console.log(`[${episodeId}] Encryption: Chunked file encryption finished.`);
        // 3. Upload the final .lsv file
        const finalEncryptedFileBuffer = fs.readFileSync(tempOutputPath);
        const encryptedStoragePath = `episodes/${episodeId}/encrypted.lsv`;
        console.log(`[${episodeId}] Encryption: Uploading encrypted file to ${encryptedStoragePath}`);
        await bucket.file(encryptedStoragePath).save(finalEncryptedFileBuffer, {
            contentType: 'application/octet-stream',
        });
        console.log(`[${episodeId}] Encryption: Upload complete.`);
        // 4. Encrypt the master key with the KEK
        const kekIv = crypto.randomBytes(12);
        const kekCipher = crypto.createCipheriv('aes-256-gcm', localKek, kekIv);
        const encryptedMasterKey = Buffer.concat([kekCipher.update(masterKey), kekCipher.final()]);
        const kekAuthTag = kekCipher.getAuthTag();
        const encryptedMasterKeyBlob = Buffer.concat([kekIv, encryptedMasterKey, kekAuthTag]);
        // 5. Store the ENCRYPTED master key and salt securely in `video_keys` collection
        const keyId = `vidkey_${episodeId}`;
        const keyDocRef = db.collection('video_keys').doc(keyId);
        await keyDocRef.set({
            keyId,
            videoId: episodeId,
            encryptedMasterKey: encryptedMasterKeyBlob.toString('base64'),
            salt: salt.toString('base64'),
            keyVersion: 3, // Version 3: Chunked with Length Header
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${episodeId}] Encryption: ENCRYPTED master key and salt saved to video_keys/${keyId}`);
        // 6. Update the episode document with new encryption metadata
        await docRef.update({
            'storage.encryptedPath': encryptedStoragePath,
            'storage.fileSize': finalEncryptedFileBuffer.length,
            'encryption': {
                algorithm: 'AES-256-GCM-CHUNKED-V3',
                version: 3,
                keyId: keyId,
                ivLength: 12,
                tagLength: 16,
                chunkSize: CHUNK_SIZE,
            },
            'status.processing': 'completed',
            'status.playable': true,
            'status.error': null,
        });
        console.log(`[${episodeId}] Encryption: Firestore document updated to 'completed' and 'playable'.`);
    }
    catch (error) {
        console.error(`[${episodeId}] File encryption process failed critically. Error:`, error);
        await docRef.update({
            'status.processing': "failed",
            'status.playable': false,
            'status.error': error.message || 'An unknown error occurred during video encryption.'
        });
    }
    finally {
        // Clean up temporary files
        if (fs.existsSync(tempInputPath))
            fs.unlinkSync(tempInputPath);
        if (fs.existsSync(tempOutputPath))
            fs.unlinkSync(tempOutputPath);
    }
}
// ==========================================
// [Trigger] 메인 분석 및 암호화 함수 (v2 onDocumentWritten)
// ==========================================
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        console.log(`[${event.params.episodeId}] Document deleted, skipping.`);
        return;
    }
    const afterData = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    if (afterData.status?.processing !== 'pending' || (beforeData && beforeData.status?.processing === afterData.status?.processing)) {
        return;
    }
    const { episodeId } = event.params;
    const docRef = change.after.ref;
    console.log(`✨ [${episodeId}] New job detected. Starting AI analysis and Encryption...`);
    // Separate status fields for AI and Encryption
    await docRef.update({
        'status.processing': 'processing',
        aiProcessingStatus: "processing"
    });
    const filePath = afterData.filePath;
    if (!filePath) {
        await docRef.update({
            'status.processing': "failed",
            'status.playable': false,
            'status.error': "No filePath found in document.",
            aiProcessingStatus: "failed",
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
    }
    catch (error) {
        console.error(`❌ [${episodeId}] A critical unexpected error occurred in Promise.all. This should not happen.`, error);
    }
});
async function runAiAnalysis(episodeId, filePath, docRef) {
    const modelName = "gemini-2.5-flash";
    console.log(`🚀 [${episodeId}] AI Processing started (Target: ${modelName}).`);
    const { genAI: localGenAI, fileManager: localFileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile = null;
    try {
        await bucket.file(filePath).download({ destination: tempFilePath });
        const uploadResponse = await localFileManager.uploadFile(tempFilePath, {
            mimeType: getMimeType(filePath),
            displayName: episodeId,
        });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] Uploaded to Google AI: ${uploadedFile.uri}`);
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const freshFile = await localFileManager.getFile(uploadedFile.name);
            state = freshFile.state;
            console.log(`... AI processing status: ${state}`);
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI file processing failed.");
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
            const startIndex = rawText.indexOf('{');
            const endIndex = rawText.lastIndexOf('}');
            if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                throw new Error("AI 응답에서 유효한 JSON 객체를 찾을 수 없습니다.");
            }
            const jsonString = rawText.substring(startIndex, endIndex + 1);
            output = JSON.parse(jsonString);
        }
        catch (jsonError) {
            console.error(`[${episodeId}] AI analysis failed: JSON parsing error. Raw output was:`, rawText);
            throw new Error(`JSON 파싱 실패: ${jsonError.message}.`);
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
                .map((item) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
                .join('\n\n')}`;
            const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
            fs.writeFileSync(vttTempPath, vttContent);
            subtitlePath = `episodes/${episodeId}/subtitles/subtitle.vtt`;
            await bucket.upload(vttTempPath, {
                destination: subtitlePath,
                metadata: { contentType: 'text/vtt', predefinedAcl: 'publicRead' },
            });
            if (fs.existsSync(vttTempPath))
                fs.unlinkSync(vttTempPath);
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
    }
    catch (error) {
        const detailedError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
        console.error(`❌ [${episodeId}] AI analysis failed. Detailed error:`, detailedError);
        await docRef.update({
            aiProcessingStatus: "failed",
            aiProcessingError: error.message || String(error),
            aiGeneratedContent: null // Ensure content is cleared on failure
        });
    }
    finally {
        if (fs.existsSync(tempFilePath) && !filePath.startsWith('/tmp/')) {
            try {
                fs.unlinkSync(tempFilePath);
            }
            catch (e) { }
        }
        if (uploadedFile) {
            try {
                await localFileManager.deleteFile(uploadedFile.name);
            }
            catch (e) { }
        }
    }
}
// ==========================================
// [Trigger] 파일 삭제 함수 (v2 onDocumentDeleted)
// ==========================================
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const { episodeId } = event.params;
    const deletedData = event.data?.data();
    console.log(`[DELETE TRIGGER] Cleaning up for episode ${episodeId}.`);
    // 1. Delete all files in the episode's main storage folder
    const prefix = `episodes/${episodeId}/`;
    try {
        console.log(`[DELETE ACTION] Deleting all storage files with prefix: ${prefix}`);
        await bucket.deleteFiles({ prefix });
        console.log(`[DELETE SUCCESS] All storage files with prefix "${prefix}" deleted.`);
    }
    catch (error) {
        console.error(`[DELETE FAILED] Could not delete storage files for episode ${episodeId}.`, error);
    }
    // 2. Delete the encryption key from `video_keys`
    try {
        const keyId = deletedData?.encryption?.keyId || `vidkey_${episodeId}`;
        const keyRef = db.collection('video_keys').doc(keyId);
        await keyRef.delete();
        console.log(`[DELETE SUCCESS] Encryption key ${keyId} deleted.`);
    }
    catch (error) {
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
const deleteStorageFileByPath = async (storage, filePath) => {
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
        }
        else {
            // console.log(`[SKIP DELETE] File does not exist, skipping deletion: ${filePath}`);
        }
    }
    catch (error) {
        if (error.code === 404) {
            // console.log(`[SKIP DELETE] File not found during cleanup, which is acceptable: ${filePath}`);
            return;
        }
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};
//# sourceMappingURL=index.js.map