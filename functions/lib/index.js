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
 * @fileoverview Video Analysis with Gemini
 * Model: gemini-2.5-flash (User Requested)
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const v2_1 = require("firebase-functions/v2");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// 0. Firebase Admin 초기화
if (!admin.apps.length) {
    admin.initializeApp();
}
// 1. 전역 옵션 설정
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: ["GOOGLE_GENAI_API_KEY"],
    timeoutSeconds: 540,
    memory: "2GiB",
});
// 2. MIME Type 도우미
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
// 3. 지연 초기화
let genAI = null;
let fileManager = null;
function initializeTools() {
    if (genAI && fileManager)
        return { genAI, fileManager };
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey)
        throw new Error("GOOGLE_GENAI_API_KEY is missing!");
    genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    fileManager = new server_1.GoogleAIFileManager(apiKey);
    return { genAI, fileManager };
}
// ==========================================
// [Trigger] 메인 분석 함수
// ==========================================
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)({
    document: "episodes/{episodeId}",
}, async (event) => {
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        console.log(`[${event.params.episodeId}] Document deleted.`);
        return;
    }
    const afterData = change.after.data();
    if (!afterData)
        return;
    const { episodeId } = event.params;
    if (afterData.aiProcessingStatus === "pending") {
        console.log(`✨ New upload detected [${episodeId}]. Starting...`);
        await change.after.ref.update({ aiProcessingStatus: "processing" });
        return;
    }
    if (afterData.aiProcessingStatus !== "processing")
        return;
    const filePath = afterData.filePath;
    if (!filePath) {
        await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath" });
        return;
    }
    // [요청하신 모델명 로그]
    console.log(`🚀 [${episodeId}] Processing started (Target: gemini-2.5-flash).`);
    const { genAI, fileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile = null;
    const bucket = admin.storage().bucket();
    try {
        await bucket.file(filePath).download({ destination: tempFilePath });
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: getMimeType(filePath),
            displayName: episodeId,
        });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] Uploaded: ${uploadedFile.uri}`);
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const freshFile = await fileManager.getFile(uploadedFile.name);
            state = freshFile.state;
            console.log(`... processing status: ${state}`);
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI processing failed.");
        console.log(`[${episodeId}] Calling Gemini 2.5 Flash...`);
        // [요청하신 모델명 적용] gemini-2.5-flash
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: generative_ai_1.SchemaType.OBJECT,
                    properties: {
                        transcript: { type: generative_ai_1.SchemaType.STRING, description: "영상의 전체 내용을 한국어로 번역한 대본" },
                        summary: { type: generative_ai_1.SchemaType.STRING, description: "영상 내용에 대한 상세한 한국어 요약문" },
                        timeline: {
                            type: generative_ai_1.SchemaType.ARRAY,
                            items: {
                                type: generative_ai_1.SchemaType.OBJECT,
                                properties: {
                                    startTime: { type: generative_ai_1.SchemaType.STRING },
                                    endTime: { type: generative_ai_1.SchemaType.STRING },
                                    subtitle: { type: generative_ai_1.SchemaType.STRING, description: "한국어로 번역된 자막" }
                                },
                                required: ["startTime", "endTime", "subtitle"]
                            }
                        },
                        visualCues: { type: generative_ai_1.SchemaType.ARRAY, items: { type: generative_ai_1.SchemaType.STRING } },
                        keywords: { type: generative_ai_1.SchemaType.ARRAY, items: { type: generative_ai_1.SchemaType.STRING } }
                    },
                    required: ["transcript", "summary", "timeline", "visualCues", "keywords"]
                }
            }
        });
        const prompt = `
      Analyze this video deeply. 
      Even if the video is in English, you MUST OUTPUT EVERYTHING IN KOREAN.
      Translate the context naturally.
      `;
        const result = await model.generateContent([
            { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
            { text: prompt }
        ]);
        const output = JSON.parse(result.response.text());
        // VTT 자막 생성
        let vttUrl = null;
        let vttPath = null;
        if (output.timeline && Array.isArray(output.timeline)) {
            const vttContent = `WEBVTT\n\n${output.timeline
                .map((item) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
                .join('\n\n')}`;
            const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
            fs.writeFileSync(vttTempPath, vttContent);
            vttPath = `episodes/${episodeId}/subtitles/${episodeId}.vtt`;
            await bucket.upload(vttTempPath, {
                destination: vttPath,
                metadata: { contentType: 'text/vtt' },
            });
            vttUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(vttPath)}?alt=media`;
            if (fs.existsSync(vttTempPath))
                fs.unlinkSync(vttTempPath);
            console.log(`[${episodeId}] VTT subtitle file created.`);
        }
        const combinedContent = `
요약: ${output.summary}\n
키워드: ${output.keywords?.join(', ') || ''}
      `.trim();
        await change.after.ref.update({
            aiProcessingStatus: "completed",
            transcript: output.transcript || "",
            aiGeneratedContent: combinedContent,
            vttUrl: vttUrl,
            vttPath: vttPath,
            aiProcessingError: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ [${episodeId}] Success!`);
    }
    catch (error) {
        // ===== 진단 로그 시작 =====
        // 이것이 가장 중요한 로그입니다. 전체 오류 객체를 보여줍니다.
        console.error(`[${episodeId}] DETAILED ERROR OBJECT:`, JSON.stringify(error, null, 2));
        // ===== 진단 로그 끝 =====
        console.error(`❌ [${episodeId}] Error:`, error);
        // Quota 에러 감지 조건을 더 넓게 설정합니다.
        const errorMessage = String(error.message || '').toLowerCase();
        if (errorMessage.includes("429") || errorMessage.includes("quota")) {
            console.log(`[${episodeId}] Quota exceeded. Re-throwing error to trigger automatic retry.`);
            // 의도적으로 에러를 다시 던져서 Cloud Functions의 자동 재시도 기능을 활성화합니다.
            throw new Error(`Quota exceeded for ${episodeId}, triggering automated retry.`);
        }
        // Quota가 아닌 다른 에러의 경우, 상태를 'failed'로 기록하고 함수를 정상 종료합니다.
        await change.after.ref.update({
            aiProcessingStatus: "failed",
            aiProcessingError: error.message || String(error)
        });
    }
    finally {
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            }
            catch (e) { }
        }
        if (uploadedFile) {
            try {
                await fileManager.deleteFile(uploadedFile.name);
            }
            catch (e) { }
        }
    }
});
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    if (!data)
        return;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    await Promise.all(paths.filter(Boolean).map(p => bucket.file(p).delete().catch(() => { })));
});
//# sourceMappingURL=index.js.map