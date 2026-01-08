
'use server';

import { onDocumentWritten, type Change, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import type { FileDataPart } from '@google/generative-ai';

// Secrets and global options
const googleApiKey = defineSecret("GEMINI_API_KEY");
setGlobalOptions({ region: 'asia-northeast3', secrets: [googleApiKey] });

// Firebase Admin SDK Initialization
if (!getApps().length) {
  initializeApp();
}

// Genkit Initialization with Google AI Plugin
enableFirebaseTelemetry();
export const ai = genkit({
  plugins: [
    googleAI({
      apiVersion: "v1beta",
    }),
  ],
  model: 'googleai/gemini-2.5-flash',
});


// Zod Schema for AI Analysis Output
const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('The full audio transcript of the video.'),
  visualSummary: z.string().describe('A summary of the key visual elements and events in the video.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords extracted from the video content.'),
});

/**
 * Cloud Function that triggers on document write in the 'episodes' collection.
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

      // 4. Call Genkit with the Gemini model
      console.log(`[${episodeId}] Sending request to Gemini 2.5 Flash model.`);
      const llmResponse = await ai.generate({
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

      // 5. Update Firestore with the analysis results
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
      // 6. Clean up the temporary file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[${episodeId}] Cleaned up temporary file: ${tempFilePath}`);
      }
    }
  }
);
