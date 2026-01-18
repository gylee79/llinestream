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
 * @fileoverview Lightweight Video Analysis (Fixed: gemini-2.5-flash)
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
// 1. 전역 옵션 설정 (미국 리전 통일)
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
// 3. 지연 초기화 (SDK)
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
    // 상태 체크
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
    console.log(`🚀 [${episodeId}] Processing started (Target: gemini-3-pro-preview).`);
    // 도구 초기화
    const { genAI, fileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile = null;
    const bucket = admin.storage().bucket();
    try {
        // 1. 다운로드
        await bucket.file(filePath).download({ destination: tempFilePath });
        // 2. 업로드 (Google AI)
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: getMimeType(filePath),
            displayName: episodeId,
        });
        uploadedFile = uploadResponse.file;
        console.log(`[${episodeId}] Uploaded: ${uploadedFile.uri}`);
        // 3. 대기 (Polling)
        let state = uploadedFile.state;
        while (state === server_1.FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const freshFile = await fileManager.getFile(uploadedFile.name);
            state = freshFile.state;
            console.log(`... processing status: ${state}`);
        }
        if (state === server_1.FileState.FAILED)
            throw new Error("Google AI processing failed.");
        // 4. AI 분석 (JSON 모드 활성화)
        console.log(`[${episodeId}] Calling Gemini 3 Pro Preview in JSON mode...`);
        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: "You are a video analysis expert. All of your text output, including summaries, transcripts, and keywords, must be in Korean. Do not use any other language under any circumstances. Provide the output as a valid JSON object only.",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
        const prompt = `이 비디오 파일을 분석하여 다음 필드를 포함하는 유효한 JSON 객체를 생성해주세요. 모든 텍스트는 반드시 한국어로 작성되어야 합니다.
- "transcript": 영상의 전체 음성 대본.
- "summary": 영상 콘텐츠에 대한 간결한 요약.
- "timeline": VTT 자막 생성을 위한 시간대별 자막 배열. 각 객체는 "startTime"(HH:MM:SS.mmm), "endTime"(HH:MM:SS.mmm), "subtitle"(한국어 자막)을 포함해야 합니다.
- "visualCues": 화면의 중요한 텍스트(OCR)나 객체 목록.
- "keywords": 관련성 높은 핵심 키워드 배열.
`;
        const result = await model.generateContent([
            { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
            { text: prompt }
        ]);
        const responseText = result.response.text();
        let output;
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("AI가 생성한 응답에서 유효한 JSON 객체를 찾을 수 없습니다.");
        }
        const jsonString = responseText.substring(jsonStart, jsonEnd + 1);
        try {
            output = JSON.parse(jsonString);
        }
        catch (parseError) {
            console.error("Final JSON parsing failed. String that was parsed:", jsonString);
            if (parseError instanceof Error) {
                throw new Error(`AI가 생성한 JSON 형식이 올바르지 않습니다: ${parseError.message}`);
            }
            throw new Error("AI가 생성한 JSON 형식이 올바르지 않습니다.");
        }
        // 5. VTT 자막 파일 생성 및 업로드
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
            fs.unlinkSync(vttTempPath); // 임시 파일 삭제
            console.log(`[${episodeId}] VTT subtitle file created and uploaded.`);
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
        console.error(`❌ [${episodeId}] Error:`, error);
        await change.after.ref.update({
            aiProcessingStatus: "failed",
            aiProcessingError: error.message || String(error)
        });
    }
    finally {
        // 6. 청소
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            }
            catch (e) { /* 무시 */ }
        }
        if (uploadedFile) {
            try {
                await fileManager.deleteFile(uploadedFile.name);
            }
            catch (e) {
                console.warn("Cleanup warning:", e);
            }
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
    await Promise.all(paths.filter(p => p).map(p => bucket.file(p).delete().catch(() => { })));
});
//# sourceMappingURL=index.js.map