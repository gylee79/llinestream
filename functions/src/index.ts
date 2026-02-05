import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';
import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

if (!admin.apps.length) { admin.initializeApp(); }

setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
  serviceAccount: "firebase-adminsdk-fbsvc@studio-6929130257-b96ff.iam.gserviceaccount.com",
});

const storage = admin.storage();
const bucket = storage.bucket();

function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".mp4" ? "video/mp4" : "video/mp4";
}

// [실제 작동 스위치]
export const analyzeVideoOnWrite = onDocumentWritten("episodes/{episodeId}", async (event) => {
    const change = event.data;
    if (!change || !change.after.exists) return;
    const data = change.after.data() as any;
    if (data.aiProcessingStatus !== 'pending') return;

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
async function createHlsPackagingJob(episodeId: string, inputUri: string, docRef: admin.firestore.DocumentReference) {
    try {
        await docRef.update({ packagingStatus: "processing", packagingError: null });
        const client = new TranscoderServiceClient();
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
                        { key: 'sd-video-stream', videoStream: { h264: { heightPixels: 480, widthPixels: 854, bitrateBps: 1000000, frameRate: 30, gopDuration: { seconds: 2 } }}},
                        { key: 'audio-stream', audioStream: { codec: 'aac', bitrateBps: 128000 } },
                    ],
                    manifests: [{ fileName: 'manifest.m3u8', type: 'HLS' as const, muxStreams: ['v-sd', 'a-sd'] }],
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
        const jobName = job.name!;
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
            } else if (checkJob.state === 'FAILED') {
                throw new Error(checkJob.error?.message || "Transcoder Job Failed");
            }
        }
    } catch (error: any) {
        await docRef.update({ packagingStatus: "failed", packagingError: error.message });
    }
}

// [AI 분석]
async function runAiAnalysis(episodeId: string, filePath: string, docRef: admin.firestore.DocumentReference) {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY!;
    const genAI = new GoogleGenerativeAI(apiKey);
    const fileManager = new GoogleAIFileManager(apiKey);
    const tempPath = path.join(os.tmpdir(), path.basename(filePath));

    try {
        await bucket.file(filePath).download({ destination: tempPath });
        const uploadResult = await fileManager.uploadFile(tempPath, { mimeType: getMimeType(filePath), displayName: episodeId });
        
        let file = await fileManager.getFile(uploadResult.file.name);
        while (file.state === FileState.PROCESSING) {
            await new Promise(res => setTimeout(res, 5000));
            file = await fileManager.getFile(uploadResult.file.name);
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([{ fileData: { mimeType: file.mimeType, fileUri: file.uri } }, { text: "이 영상을 한국어로 요약하고 타임라인을 만들어줘." }]);

        await docRef.update({ aiGeneratedContent: result.response.text(), aiProcessingStatus: "completed" });
    } catch (error) {
        console.error("AI Error:", error);
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    await bucket.deleteFiles({ prefix: `episodes/${event.params.episodeId}/` });
});