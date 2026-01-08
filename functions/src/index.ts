
import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { onDocumentWritten, Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import { defineSecret, setGlobalOptions } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';
import { DocumentSnapshot } from 'firebase-admin/firestore';

// --- Configuration ---

// 1. Set global options for all functions
setGlobalOptions({ region: 'asia-northeast3' });

// 2. Define the secret for the Google AI API Key
const apiKey = defineSecret('GOOGLE_GENAI_API_KEY');

// 3. Initialize Firebase Admin SDK if not already done
if (!getApps().length) {
  admin.initializeApp();
}

// 4. Configure Genkit with the specified model as per documentation
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-2.5-flash'), // Explicitly set the model
});

// 5. Define the Zod schema for the expected AI output
const AnalysisOutputSchema = z.object({
  visualSummary: z.string().describe('A summary of the key visual elements and events in the video transcript.'),
  keywords: z.array(z.string()).describe('An array of relevant keywords extracted from the video transcript.'),
});

// --- Cloud Function ---

/**
 * Firestore trigger that analyzes a video's transcript using Genkit AI.
 * This function activates when an episode document is written with:
 * - `status: 'processing'`
 * - A non-empty `transcript` field.
 */
export const analyzeVideoTranscript = onDocumentWritten(
  {
    document: 'episodes/{episodeId}',
    secrets: [apiKey],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const { episodeId } = event.params;
    const change = event.data;

    if (!change) {
      console.log(`[${episodeId}] No data change, skipping.`);
      return;
    }

    const afterData = change.after.data();
    const episodeRef = change.after.ref;

    // --- Execution Guard ---
    // Only proceed if status is 'processing' and a transcript is available.
    if (!afterData || afterData.status !== 'processing' || !afterData.transcript) {
      console.log(`[${episodeId}] Skipping: Status is not 'processing' or transcript is missing.`);
      return;
    }

    console.log(`[${episodeId}] Starting AI analysis for transcript.`);

    try {
      // --- AI Generation Call ---
      // Uses the transcript from the Firestore document as the prompt.
      const prompt = `Analyze this video transcript and provide a visual summary and keywords.
        Transcript:
        ---
        ${afterData.transcript}
        ---
      `;

      // The 'as any' is used here to bypass strict TypeScript overload checks for deployment stability.
      const llmResponse = await ai.generate({
        prompt: prompt,
        output: {
          format: 'json',
          schema: AnalysisOutputSchema,
        },
        config: { temperature: 0.2 },
      } as any);

      const analysisResult = llmResponse.output;
      if (!analysisResult) {
        throw new Error('AI analysis returned no output.');
      }
      
      console.log(`[${episodeId}] AI analysis completed successfully.`);

      // --- Update Firestore ---
      // Combine the results and update the document, marking the process as 'completed'.
      await episodeRef.update({
        aiGeneratedContent: `Keywords: ${analysisResult.keywords.join(', ')}\n\nVisual Summary:\n${analysisResult.visualSummary}`,
        status: 'completed',
      });

      console.log(`[${episodeId}] Firestore updated with analysis results.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error(`[${episodeId}] AI analysis failed:`, error);
      // Mark as failed and log the error message for debugging.
      await episodeRef.update({
        status: 'failed',
        aiProcessingError: errorMessage,
      });
    }
  }
);
