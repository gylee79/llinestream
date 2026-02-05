/**
 * @fileoverview Video Analysis with Gemini & Transcoder API using Firebase Cloud Functions v2.
 * Gemini Model: gemini-2.5-flash
 * Transcoder API for HLS Packaging with AES-128 encryption.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';
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

// 2. 지연 초기화
let genAI: GoogleGenerativeAI | null = null;
let fileManager: GoogleAIFileManager | null = null;
let transcoderClient: TranscoderServiceClient | null = null;

function initializeTools() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");
  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  if (!fileManager) fileManager = new GoogleAIFileManager(apiKey);
  if (!transcoderClient) transcoderClient = new TranscoderServiceClient();
  return { genAI, fileManager, transcoderClient };
}

// 3. [수정 완료] HLS Packaging with Transcoder API
async function createHlsPackagingJob(episodeId: string, inputUri: string, docRef: admin.firestore.DocumentReference): Promise<void> {
    try {
        await docRef.update({ packagingStatus: "processing", packagingError: null });

        const { transcoderClient: client } = initializeTools();
        const projectId = await client.getProjectId();
        const location = 'us-central1';
        const outputUri = `gs://${bucket.name}/episodes/${episodeId}/packaged/`;

        // 16자리 비밀 키 생성 및 저장
        const aesKey = crypto.randomBytes(16);
        const keyStoragePath = `episodes/${episodeId}/keys/enc.key`;
        await bucket.file(keyStoragePath).save(aesKey, { contentType: 'application/octet-stream' });
        
        // 플레이어용 Signed URL 생성
        const [signedKeyUrl] = await bucket.file(keyStoragePath).getSignedUrl({ 
            action: 'read', 
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000 
        });

        // [핵심 수정] 구글 트랜스코더 v1 공식 규격 작업 지시서
        const request = {
            parent: `projects/${projectId}/locations/${location}`,
            job: {
                inputUri,
                outputUri,
                config: {
                    // 비디오와 오디오 상자를 각각 fmp4로 따로 담습니다
                    muxStreams: [
                        {
                            key: 'v-sd',
                            container: 'fmp4',
                            elementaryStreams: ['sd-video-stream'],
                            segmentSettings: { individualSegments: true, segmentDuration: { seconds: 4 } },
                            encryptionId: 'aes-128-lock', // 아래 encryptions와 연결
                        },
                        {
                            key: 'a-sd',
                            container: 'fmp4',
                            elementaryStreams: ['audio-stream'],
                            segmentSettings: { individualSegments: true, segmentDuration: { seconds: 4 } },
                            encryptionId: 'aes-128-lock',
                        }
                    ],
                    elementaryStreams: [
                        { key: 'sd-video-stream', videoStream: { h264: { 
                            heightPixels: 480, widthPixels: 854, bitrateBps: 1000000, frameRate: 30,
                            gopDuration: { seconds: 2 } // 수학적 정렬 (4/2=정수)
                        }}},
                        { key: 'audio-stream', audioStream: { codec: 'aac', bitrateBps: 128000 } },
                    ],
                    manifests: [{ 
                        fileName: 'manifest.m3u8', 
                        type: 'HLS' as const, 
                        muxStreams: ['v-sd', 'a-sd'] 
                    }],
                    // [에러 해결의 핵심] 자물쇠 정의를 바깥으로 뺐습니다
                    encryptions: [{ 
                        id: 'aes-128-lock', 
                        aes128: { uri: signedKeyUrl },
                        drmSystems: { clearkey: {} }, // 👈 이 줄이 없어서 에러가 났던 것입니다!
                        encryptionMode: 'cenc' // fmp4 필수 설정
                    }],
                },
            },
        };
        
        console.log(`[${episodeId}] HLS Job: Creating...`);
        const [job] = await client.createJob(request);
        const jobName = job.name!;

        const POLLING_INTERVAL = 15000;
        const MAX_POLLS = 35;
        let jobSucceeded = false;

        for (let i = 0; i < MAX_POLLS; i++) {
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
            const [checkJob] = await client.getJob({ name: jobName });
            console.log(`[${episodeId}] Polling: ${checkJob.state}`);

            if (checkJob.state === 'SUCCEEDED') {
                await docRef.update({
                    packagingStatus: 'completed',
                    manifestUrl: `${outputUri}manifest.m3u8`.replace(`gs://${bucket.name}/`, `https://storage.googleapis.com/${bucket.name}/`),
                    keyServerUrl: signedKeyUrl, // 👈 헐크님이 찾으시던 그 열쇠 주소입니다!
                    packagingError: null,
                });
                jobSucceeded = true;
                break;
            } else if (checkJob.state === 'FAILED') {
                throw new Error(`Transcoder failed: ${JSON.stringify(checkJob.error)}`);
            }
        }
        if (!jobSucceeded) throw new Error('Transcoder job timed out.');

    } catch (error: any) {
        console.error(`❌ [${episodeId}] Packaging Failed:`, error);
        await docRef.update({ packagingStatus: "failed", packagingError: error.message });
    }
}

// 이후 analyzeVideoOnWrite, runAiAnalysis, deleteFilesOnEpisodeDelete 로직은 헐크님 코드와 동일하게 유지됩니다.
// (지면 관계상 생략하지만, 헐크님의 기존 코드를 이 아래에 그대로 붙여넣으시면 됩니다.)