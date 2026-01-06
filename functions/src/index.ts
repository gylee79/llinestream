import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initializeGenkit } from './genkit';
import { generate } from 'genkit/ai';
import { Part, FileDataPart } from '@google/generative-ai';
import { z } from 'zod';

// Firebase Admin SDK 초기화
admin.initializeApp();
// Genkit 초기화
initializeGenkit();

// AI 응답을 위한 Zod 스키마 정의
const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('The full audio transcript of the video.'),
  visualSummary: z.string().describe('A summary of the key visual elements and events in the video.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords extracted from the video content.'),
});

/**
 * Firestore 'episodes' 컬렉션에 문서가 생성될 때 트리거되는 Cloud Function.
 * 비디오를 다운로드하고, Genkit을 사용하여 AI 분석을 수행한 후, 결과를 Firestore에 다시 쓴다.
 */
export const analyzeVideoOnCreate = functions.runWith({
    timeoutSeconds: 540, // 9분 타임아웃
    memory: '1GiB',      // 1GB 메모리 할당
}).firestore
  .document('episodes/{episodeId}')
  .onCreate(async (snap, context) => {
    const episodeData = snap.data();
    const { episodeId } = context.params;

    // aiProcessingStatus가 'pending'이 아니거나 videoUrl이 없으면 함수 종료
    if (episodeData.aiProcessingStatus !== 'pending' || !episodeData.videoUrl) {
      functions.logger.info(`[${episodeId}] Skipping analysis. Status: ${episodeData.aiProcessingStatus}, URL: ${!!episodeData.videoUrl}`);
      return null;
    }

    const episodeRef = snap.ref;
    const videoUrl = episodeData.videoUrl;

    // 1. 상태를 'processing'으로 즉시 업데이트
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });
    functions.logger.info(`[${episodeId}] Status updated to 'processing'.`);

    const tempFilePath = path.join(os.tmpdir(), `episode_${episodeId}.mp4`);

    try {
      // 2. Firebase Storage에서 비디오 파일을 스트림으로 다운로드
      const bucket = admin.storage().bucket();
      const file = bucket.file(episodeData.filePath); // Assuming filePath is stored on the document

      functions.logger.info(`[${episodeId}] Starting video download from ${episodeData.filePath}.`);
      await file.download({ destination: tempFilePath });
      functions.logger.info(`[${episodeId}] Video downloaded to temporary path: ${tempFilePath}`);
      
      const fileBuffer = fs.readFileSync(tempFilePath);
      
      // 3. Genkit Input을 위한 Part 생성
      const videoFilePart: FileDataPart = {
        data: {
          contents: fileBuffer,
          mimeType: 'video/mp4',
        }
      };
      
      const prompt = `Analyze this video and provide the following in JSON format:
        1) 'transcript': The full audio transcript.
        2) 'visualSummary': A summary of key visual elements.
        3) 'keywords': An array of relevant keywords.`;

      // 4. Genkit을 사용하여 Gemini 2.5 Flash 모델 호출
      functions.logger.info(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
      const llmResponse = await generate({
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
      
      functions.logger.info(`[${episodeId}] AI analysis successful.`);

      // 5. Firestore에 결과 저장
      await episodeRef.update({
        transcript: analysisResult.transcript,
        aiGeneratedContent: `Keywords: ${analysisResult.keywords.join(', ')}\n\nVisual Summary:\n${analysisResult.visualSummary}`,
        aiProcessingStatus: 'completed',
      });
      functions.logger.info(`[${episodeId}] Firestore updated with analysis results.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      functions.logger.error(`[${episodeId}] AI analysis failed:`, error);
      await episodeRef.update({
        aiProcessingStatus: 'failed',
        aiProcessingError: errorMessage,
      });

    } finally {
      // 6. 임시 파일 정리
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        functions.logger.info(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
      }
    }

    return null;
  });
