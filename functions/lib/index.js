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
exports.analyzeVideoOnWrite = void 0;
const functions = __importStar(require("firebase-functions/v2/firestore"));
const admin = __importStar(require("firebase-admin"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const genkit_1 = require("./genkit");
const ai_1 = require("genkit/ai");
const zod_1 = require("zod");
const v2_1 = require("firebase-functions/v2");
// Cloud Functions 리전 및 옵션 설정 (중요)
(0, v2_1.setGlobalOptions)({ region: 'asia-northeast3' });
// Firebase Admin SDK 초기화
admin.initializeApp();
// Genkit 초기화
(0, genkit_1.initializeGenkit)();
// AI 응답을 위한 Zod 스키마 정의
const AnalysisOutputSchema = zod_1.z.object({
    transcript: zod_1.z.string().describe('The full audio transcript of the video.'),
    visualSummary: zod_1.z.string().describe('A summary of the key visual elements and events in the video.'),
    keywords: zod_1.z.array(zod_1.z.string()).describe('An array of relevant keywords extracted from the video content.'),
});
/**
 * Firestore 'episodes' 컬렉션의 문서가 생성되거나 업데이트 될 때 트리거되는 Cloud Function.
 */
exports.analyzeVideoOnWrite = functions.onDocumentWritten({
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
    // 멱등성(Idempotency) 로직:
    // 'pending' 상태일 때만 함수를 실행합니다.
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
    // 1. 상태를 'processing'으로 즉시 업데이트하여 중복 실행 방지
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });
    console.log(`[${episodeId}] Status updated to 'processing'.`);
    const tempFilePath = path.join(os.tmpdir(), `episode_${episodeId}_${Date.now()}.mp4`);
    try {
        // 2. Firebase Storage에서 비디오 파일을 스트림으로 다운로드
        const bucket = admin.storage().bucket();
        const file = bucket.file(filePath);
        console.log(`[${episodeId}] Starting video download from gs://${bucket.name}/${filePath} to ${tempFilePath}.`);
        await file.download({ destination: tempFilePath });
        console.log(`[${episodeId}] Video downloaded successfully.`);
        const videoFilePart = {
            fileData: {
                filePath: tempFilePath,
                mimeType: 'video/mp4',
            }
        };
        const prompt = `Analyze this video and provide the following in JSON format:
        1) 'transcript': The full audio transcript.
        2) 'visualSummary': A summary of key visual elements.
        3) 'keywords': An array of relevant keywords.`;
        // 4. Genkit을 사용하여 Gemini 2.5 Flash 모델 호출
        console.log(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
        const llmResponse = await (0, ai_1.generate)({
            model: 'googleai/gemini-2.5-flash',
            prompt: [prompt, videoFilePart],
            output: {
                format: 'json',
                schema: AnalysisOutputSchema,
            },
        });
        const analysisResult = llmResponse.output();
        if (!analysisResult) {
            throw new Error('AI analysis returned no output.');
        }
        console.log(`[${episodeId}] AI analysis successful.`);
        // 5. Firestore에 결과 저장
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
        // 6. 임시 파일 정리
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
        }
    }
});
//# sourceMappingURL=index.js.map