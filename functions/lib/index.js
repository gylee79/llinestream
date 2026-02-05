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
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
const video_transcoder_1 = require("@google-cloud/video-transcoder");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
if (!admin.apps.length) {
    admin.initializeApp();
}
(0, v2_1.setGlobalOptions)({
    region: "us-central1",
    secrets: ["GOOGLE_GENAI_API_KEY"],
    timeoutSeconds: 540,
    memory: "2GiB",
    serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});
const storage = admin.storage();
const bucket = storage.bucket();
function getMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return extension === ".mp4" ? "video/mp4" : "video/mp4";
}
// [실제 작동 스위치]
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists)
        return;
    const data = change.after.data();
    if (data.aiProcessingStatus !== 'pending')
        return;
    const { episodeId } = event.params;
    const docRef = change.after.ref;
    const inputUri = `gs://${bucket.name}/${data.filePath}`;
    console.log(`🚀 [${episodeId}] 분석 및 패키징 시작!`);
    await docRef.update({ aiProcessingStatus: "processing" });
    await Promise.allSettled([
        runAiAnalysis(episodeId, data.filePath, docRef),
        createHlsPackagingJob(episodeId, inputUri, docRef)
    ]);
});
// [비디오 패키징 - 🚨 실패 원인 완벽 해결]
async function createHlsPackagingJob(episodeId, inputUri, docRef) {
    try {
        await docRef.update({ packagingStatus: "processing", packagingError: null });
        const client = new video_transcoder_1.TranscoderServiceClient();
        const projectId = await client.getProjectId();
        const location = 'us-central1';
        const outputUri = `gs://${bucket.name}/episodes/${episodeId}/packaged/`;
        const aesKey = crypto.randomBytes(16);
        const keyStoragePath = `episodes/${episodeId}/keys/enc.key`;
        await bucket.file(keyStoragePath).save(aesKey, { contentType: 'application/octet-stream' });
        const [signedKeyUrl] = await bucket.file(keyStoragePath).getSignedUrl({
            action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000
        });
        const request = {
            parent: `projects/${projectId}/locations/${location}`,
            job: {
                inputUri, outputUri,
                config: {
                    muxStreams: [
                        { key: 'v-sd', container: 'fmp4', elementaryStreams: ['sd-video-stream'],
                            segmentSettings: { individualSegments: true, segmentDuration: { seconds: 4 } },
                            encryptionId: 'aes-lock' },
                        { key: 'a-sd', container: 'fmp4', elementaryStreams: ['audio-stream'],
                            segmentSettings: { individualSegments: true, segmentDuration: { seconds: 4 } },
                            encryptionId: 'aes-lock' }
                    ],
                    elementaryStreams: [
                        { key: 'sd-video-stream', videoStream: { h264: { heightPixels: 480, widthPixels: 854, bitrateBps: 1000000, frameRate: 30, gopDuration: { seconds: 2 } } } },
                        { key: 'audio-stream', audioStream: { codec: 'aac', bitrateBps: 128000 } },
                    ],
                    manifests: [{ fileName: 'manifest.m3u8', type: 'HLS', muxStreams: ['v-sd', 'a-sd'] }],
                    // 🚨 핵심 수정: encryptionMode를 'cenc'로 명시하여 에러 해결
                    encryptions: [{
                            id: 'aes-lock',
                            aes128: { uri: signedKeyUrl },
                            drmSystems: { clearkey: {} },
                            encryptionMode: 'cenc'
                        }],
                },
            },
        };
        const [job] = await client.createJob(request);
        const jobName = job.name;
        for (let i = 0; i < 35; i++) {
            await new Promise(res => setTimeout(res, 15000));
            const [checkJob] = await client.getJob({ name: jobName });
            if (checkJob.state === 'SUCCEEDED') {
                await docRef.update({
                    packagingStatus: 'completed',
                    manifestUrl: `${outputUri}manifest.m3u8`.replace(`gs://${bucket.name}/`, `https://storage.googleapis.com/${bucket.name}/`),
                    packagingError: null,
                });
                return;
            }
            else if (checkJob.state === 'FAILED') {
                throw new Error(checkJob.error?.message || "Transcoder Job Failed");
            }
        }
    }
    catch (error) {
        await docRef.update({ packagingStatus: "failed", packagingError: error.message });
    }
}
// [AI 분석]
async function runAiAnalysis(episodeId, filePath, docRef) {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const fileManager = new server_1.GoogleAIFileManager(apiKey);
    const tempPath = path.join(os.tmpdir(), path.basename(filePath));
    try {
        await bucket.file(filePath).download({ destination: tempPath });
        const uploadResult = await fileManager.uploadFile(tempPath, { mimeType: getMimeType(filePath), displayName: episodeId });
        let file = await fileManager.getFile(uploadResult.file.name);
        while (file.state === server_1.FileState.PROCESSING) {
            await new Promise(res => setTimeout(res, 5000));
            file = await fileManager.getFile(uploadResult.file.name);
        }
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([{ fileData: { mimeType: file.mimeType, fileUri: file.uri } }, { text: "이 영상을 한국어로 요약하고 타임라인을 만들어줘." }]);
        await docRef.update({ aiGeneratedContent: result.response.text(), aiProcessingStatus: "completed" });
    }
    catch (error) {
        console.error("AI Error:", error);
    }
    finally {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
    }
}
exports.deleteFilesOnEpisodeDelete = (0, firestore_1.onDocumentDeleted)("episodes/{episodeId}", async (event) => {
    await bucket.deleteFiles({ prefix: `episodes/${event.params.episodeId}/` });
});
//# sourceMappingURL=index.js.map