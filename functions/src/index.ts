
'use server';

import { onDocumentWritten, type Change, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { type DocumentSnapshot } from 'firebase-admin/firestore';
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

// AI 응답을 위한 Zod 스키마 정의
const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('The full audio transcript of the video.'),
  visualSummary: z.string().describe('A summary of the key visual elements and events in the video.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords extracted from the video content.'),
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
      
      const prompt = `Analyze this video and provide the following in JSON format:
        1) 'transcript': The full audio transcript.
        2) 'visualSummary': A summary of key visual elements.
        3) 'keywords': An array of relevant keywords.`;

      // 4. Genkit을 사용하여 Gemini 2.5 Flash 모델 호출
      console.log(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
      const llmResponse = await ai.generate({
        prompt: [prompt, videoFilePart] as any, // Use 'as any' to bypass temporary typecheck issue
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

      // 5. Firestore에 결과 저장
      await episodeRef.update({
        transcript: analysisResult.transcript,
        aiGeneratedContent: `Keywords: ${analysisResult.keywords.join(', ')}\n\nVisual Summary:\n${analysisResult.visualSummary}`,
        aiProcessingStatus: 'completed',
      });
      console.log(`[${episodeId}] Firestore updated with analysis results.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error(`[${episodeId}] AI analysis failed:`, error);
      await episodeRef.update({
        aiProcessingStatus: 'failed',
        aiProcessingError: errorMessage,
      });

    } finally {
      // 6. 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
      }
    }
  }
);
