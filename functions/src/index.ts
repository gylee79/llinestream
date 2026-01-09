
'use server';

import { onDocumentWritten, type Change, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { ai } from './genkit.js';
import { z } from 'zod';
import { setGlobalOptions } from 'firebase-functions/v2';
import type { FileDataPart } from '@google/generative-ai';

// Cloud Functions 리전 및 옵션 설정 (중요)
setGlobalOptions({ region: 'asia-northeast3' });

// Firebase Admin SDK 초기화 (ESM 방식)
if (!getApps().length) {
  initializeApp();
}

// Genkit은 genkit.ts에서 초기화되고 여기서 import 됩니다.

// AI 응답을 위한 확장된 Zod 스키마 정의
const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('The full and accurate audio transcript of the video.'),
  summary: z.string().describe('A concise summary of the entire video content.'),
  timeline: z.array(z.object({
    timestamp: z.string().describe('The timestamp of the event in HH:MM:SS format.'),
    event: z.string().describe('A description of what is happening at this timestamp.'),
    visualDetail: z.string().describe('Notable visual details, like objects or character appearances.'),
  })).describe('An array of time-stamped logs detailing events throughout the video.'),
  visualCues: z.array(z.string()).describe('A list of important on-screen text (OCR) or significant visual objects.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords for searching and tagging.'),
});

/**
 * Firestore 'episodes' 컬렉션의 문서가 생성되거나 업데이트 될 때 트리거되는 Cloud Function.
 */
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: 'episodes/{episodeId}',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) {
      console.log(`[${event.params.episodeId}] Event data is undefined, skipping.`);
      return;
    }

    const { episodeId } = event.params;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    // 문서가 삭제되었거나, aiProcessingStatus가 없는 경우 함수 종료
    if (!afterData) {
        console.log(`[${episodeId}] Document was deleted, skipping analysis.`);
        return;
    }
    
    // --- 1. 자동화 로직: 'pending' 상태를 감지하고 'processing'으로 변경 ---
    if (afterData.aiProcessingStatus === 'pending') {
        // 이미 'pending'에서 'processing'으로 변경되는 과정에 있다면 중복 실행 방지
        if (beforeData?.aiProcessingStatus === 'pending' && afterData.aiProcessingStatus === 'pending') {
            console.log(`[${episodeId}] Status is 'pending', updating to 'processing' to start analysis.`);
            await change.after.ref.update({ aiProcessingStatus: 'processing' });
            // 상태 업데이트 후 함수를 종료합니다. 이 업데이트가 함수를 다시 트리거하여 아래의 분석 로직을 실행하게 됩니다.
            return;
        }
    }

    // --- 2. 분석 실행 로직: 'processing' 상태일 때만 실제 분석 수행 ---
    if (afterData.aiProcessingStatus !== 'processing') {
      console.log(`[${episodeId}] Status is not 'processing' (it's '${afterData.aiProcessingStatus}'), skipping main logic.`);
      return;
    }
    
    // 이미 처리 중인 상태로 변경된 경우 중복 실행 방지
    if(beforeData?.aiProcessingStatus === 'processing' && afterData.aiProcessingStatus === 'processing') {
        console.log(`[${episodeId}] Analysis is already in progress, skipping duplicate run.`);
        return;
    }

    console.log(`[${episodeId}] AI analysis triggered. Status is 'processing'.`);
    
    const episodeRef = change.after.ref;
    const filePath = afterData.filePath;

    if (!filePath) {
      console.error(`[${episodeId}] filePath is missing.`);
      await episodeRef.update({ aiProcessingStatus: 'failed', aiProcessingError: 'Video file path is missing.' });
      return;
    }

    const tempFilePath = path.join(os.tmpdir(), `episode_${episodeId}_${Date.now()}.mp4`);

    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(filePath);

      console.log(`[${episodeId}] Starting video download from gs://${bucket.name}/${filePath} to ${tempFilePath}.`);
      await file.download({ destination: tempFilePath });
      console.log(`[${episodeId}] Video downloaded successfully.`);
      
      const videoFilePart: FileDataPart = {
        fileData: {
          fileUri: `file://${tempFilePath}`,
          mimeType: 'video/mp4',
        }
      };
      
      const prompt = `Analyze this video file comprehensively. Extract all the information required by the provided JSON schema, including a full transcript, a summary, a detailed timeline of events, visual cues like on-screen text, and a list of keywords.

        Please provide the output in a structured JSON format that adheres to the following schema:
        - transcript: The full audio transcript.
        - summary: A high-level summary of the video.
        - timeline: A detailed log of events with timestamps.
        - visualCues: Important text or objects visible on screen.
        - keywords: A list of main topics and keywords.`;

      console.log(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
      const llmResponse = await ai.generate({
        model: 'gemini-2.5-flash',
        prompt: [prompt, videoFilePart],
        output: {
          format: 'json',
          schema: AnalysisOutputSchema,
        },
      } as any);

      const analysisResult = llmResponse.output;
      if (!analysisResult) {
        throw new Error('AI analysis returned no output.');
      }
      
      console.log(`[${episodeId}] AI analysis successful.`);

      const combinedContent = `
        Summary: ${analysisResult.summary}\n\n
        Timeline:
        ${analysisResult.timeline.map(t => `- ${t.timestamp}: ${t.event} (Visuals: ${t.visualDetail})`).join('\n')}\n\n
        Visual Cues: ${analysisResult.visualCues.join(', ')}\n\n
        Keywords: ${analysisResult.keywords.join(', ')}
      `.trim();

      await episodeRef.update({
        transcript: analysisResult.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingStatus: 'completed',
        aiProcessingError: null, // Clear any previous error
      });
      console.log(`[${episodeId}] Firestore updated with detailed analysis results.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error(`[${episodeId}] AI analysis failed:`, error);
      await episodeRef.update({
        aiProcessingStatus: 'failed',
        aiProcessingError: errorMessage,
      });

    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
      }
    }
  }
);
