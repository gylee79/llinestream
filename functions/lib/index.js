'use server';
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
exports.analyzeVideoOnWrite = exports.ai = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const app_1 = require("firebase-admin/app");
const storage_1 = require("firebase-admin/storage");
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const firebase_1 = require("@genkit-ai/firebase");
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
// Secrets and global options
const apiKey = (0, params_1.defineSecret)("GOOGLE_GENAI_API_KEY");
(0, v2_1.setGlobalOptions)({ region: 'asia-northeast3', secrets: [apiKey] });
// Firebase Admin SDK Initialization
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
// Genkit Initialization with Google AI Plugin
(0, firebase_1.enableFirebaseTelemetry)();
exports.ai = (0, genkit_1.genkit)({
    plugins: [
        (0, google_genai_1.googleAI)(),
    ],
    model: google_genai_1.googleAI.model('gemini-2.5-flash'),
});
// Zod Schema for AI Analysis Output
const AnalysisOutputSchema = genkit_1.z.object({
    transcript: genkit_1.z.string().describe('The full audio transcript of the video.'),
    visualSummary: genkit_1.z.string().describe('A summary of the key visual elements and events in the video.'),
    keywords: genkit_1.z.array(genkit_1.z.string()).describe('An array of relevant keywords extracted from the video content.'),
});
/**
 * Cloud Function that triggers on document write in the 'episodes' collection.
 */
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)({
    document: 'episodes/{episodeId}',
    timeoutSeconds: 540,
    memory: '1GiB',
}, async (event) => {
    const change = event.data;
    if (!change) {
        console.log(`[${event.params.episodeId}] Event data is undefined, skipping.`);
        return;
    }
    const { episodeId } = event.params;
    const afterData = change.after.data();
    // Idempotency check: Only run for 'pending' status
    if (!afterData || afterData.aiProcessingStatus !== 'pending') {
        console.log(`[${episodeId}] Status is not 'pending' (${afterData?.aiProcessingStatus || 'deleted'}), skipping.`);
        return;
    }
    console.log(`[${episodeId}] AI analysis triggered for document write.`);
    const episodeRef = change.after.ref;
    const filePath = afterData.filePath;
    if (!filePath) {
        console.error(`[${episodeId}] filePath is missing.`);
        await episodeRef.update({ aiProcessingStatus: 'failed', aiProcessingError: 'Video file path is missing.' });
        return;
    }
    // 1. Update status to 'processing' to prevent redundant executions
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });
    console.log(`[${episodeId}] Status updated to 'processing'.`);
    const tempFilePath = path.join(os.tmpdir(), `episode_${episodeId}_${Date.now()}.mp4`);
    try {
        // 2. Download video file from Firebase Storage
        const bucket = (0, storage_1.getStorage)().bucket();
        const file = bucket.file(filePath);
        console.log(`[${episodeId}] Starting video download from gs://${bucket.name}/${filePath} to ${tempFilePath}.`);
        await file.download({ destination: tempFilePath });
        console.log(`[${episodeId}] Video downloaded successfully.`);
        const videoFilePart = {
            fileData: {
                fileUri: `file://${tempFilePath}`,
                mimeType: 'video/mp4',
            }
        };
        const prompt = `Analyze this video and provide the following in JSON format:
        1) 'transcript': The full audio transcript.
        2) 'visualSummary': A summary of key visual elements.
        3) 'keywords': An array of relevant keywords.`;
        // 4. Call Genkit with the Gemini model
        console.log(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
        const llmResponse = await exports.ai.generate({
            prompt: [prompt, videoFilePart],
            output: {
                format: 'json',
                schema: AnalysisOutputSchema,
            },
        });
        const analysisResult = llmResponse.output;
        if (!analysisResult) {
            throw new Error('AI analysis returned no output.');
        }
        console.log(`[${episodeId}] AI analysis successful.`);
        // 5. Update Firestore with the analysis results
        await episodeRef.update({
            transcript: analysisResult.transcript,
            aiGeneratedContent: `Keywords: ${analysisResult.keywords.join(', ')}\n\nVisual Summary:\n${analysisResult.visualSummary}`,
            aiProcessingStatus: 'completed',
        });
        console.log(`[${episodeId}] Firestore updated with analysis results.`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error(`[${episodeId}] AI analysis failed:`, error);
        await episodeRef.update({
            aiProcessingStatus: 'failed',
            aiProcessingError: errorMessage,
        });
    }
    finally {
        // 6. Clean up the temporary file
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
        }
    }
});
//# sourceMappingURL=index.js.map