
'use server';
/**
 * @fileOverview AI Tutor flow for answering questions about a video episode.
 *
 * This flow takes a user's question about a specific video episode,
 * searches for relevant context within a specified scope,
 * and generates a helpful answer based on that context.
 *
 * - askVideoTutor - a function that handles the question-answering process.
 * - VideoTutorInput - The input type for the askVideoTutor function.
 * - VideoTutorOutput - The return type for the askVideoTutor function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Course, Classification, Episode, AiSearchScope } from '@/lib/types';

// Helper function to remove milliseconds from a timestamp string (e.g., "HH:MM:SS.mmm" -> "HH:MM:SS")
function removeMilliseconds(timestamp: string): string {
    if (typeof timestamp === 'string' && timestamp.includes('.')) {
        return timestamp.split('.')[0];
    }
    return timestamp;
}

const VideoTutorInputSchema = z.object({
  episodeId: z.string().describe('The ID of the video episode being asked about.'),
  question: z.string().describe("The user's question about the video."),
  userId: z.string().describe('The ID of the user asking the question.'),
});
export type VideoTutorInput = z.infer<typeof VideoTutorInputSchema>;

const VideoTutorOutputSchema = z.object({
  answer: z.string().describe('The generated answer from the AI tutor.'),
});
export type VideoTutorOutput = z.infer<typeof VideoTutorOutputSchema>;

export async function askVideoTutor(input: VideoTutorInput): Promise<VideoTutorOutput> {
  return await videoTutorFlow(input);
}

const videoTutorFlow = ai.defineFlow(
  {
    name: 'videoTutorFlow',
    inputSchema: VideoTutorInputSchema,
    outputSchema: VideoTutorOutputSchema,
  },
  async ({ episodeId, question, userId }) => {
    console.log(`[Tutor-Flow] Starting for episode ${episodeId} with question: "${question}"`);

    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    
    try {
      // 1. Get the full hierarchy for the given episode
      const episodeDoc = await db.collection('episodes').doc(episodeId).get();
      if (!episodeDoc.exists) throw new Error(`Episode with ID ${episodeId} not found.`);
      const episodeData = episodeDoc.data() as Episode;

      // From Spec 9: AI Analyzer Guard Conditions
      const { pipeline, playable } = episodeData.status;
      const { manifestPath } = episodeData.storage;
      const { status: aiStatus } = episodeData.ai;

      if (pipeline !== 'completed' || !playable || !manifestPath || aiStatus === 'blocked') {
         const errorMessage = `AI 튜터를 사용할 수 없습니다. (이유: ${aiStatus === 'blocked' ? episodeData.ai.error?.code : '영상 처리 미완료'})`;
         console.warn(`[Tutor-Flow] Guard Blocked for ${episodeId}: ${errorMessage}`);
         return { answer: errorMessage };
      }
      
      const courseDoc = await db.collection('courses').doc(episodeData.courseId).get();
      if (!courseDoc.exists) throw new Error(`Course ${episodeData.courseId} not found.`);
      const courseData = courseDoc.data() as Course;

      const classificationDoc = await db.collection('classifications').doc(courseData.classificationId).get();
      if (!classificationDoc.exists) throw new Error(`Classification ${courseData.classificationId} not found.`);
      const classificationData = classificationDoc.data() as Classification;
      
      const fieldDoc = await db.collection('fields').doc(classificationData.fieldId).get();
      if (!fieldDoc.exists) throw new Error(`Field ${classificationData.fieldId} not found.`);
      const fieldData = fieldDoc.data();

      // New: Fetch all episodes once to create a title map
      const allEpisodesSnapshot = await db.collection('episodes').get();
      const episodeTitleMap = new Map<string, string>();
      allEpisodesSnapshot.forEach(doc => {
          episodeTitleMap.set(doc.id, doc.data().title);
      });

      // 2. Build context
      // Note: This implementation is simplified. A real production system would use a vector database (e.g., Vertex AI Vector Search)
      // for semantic search across many documents, rather than stuffing all text into the context.
      // For now, we'll fetch the transcript directly if it exists.
      const transcriptPath = episodeData.ai.resultPaths?.transcript;
      let context = "No transcript available.";

      if (transcriptPath) {
          const file = admin.storage(adminApp).bucket().file(transcriptPath);
          const [exists] = await file.exists();
          if (exists) {
              const [buffer] = await file.download();
              context = buffer.toString('utf-8');
          }
      }

      // 3. Generate the answer using Gemini with the constructed context
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-2.5-flash'),
        system: `You are a friendly and helpful Korean AI Tutor. You MUST answer all questions in Korean.
        You will be given a full video transcript as context.
        The user is currently watching the episode titled '${episodeData.title}'.

        Based ONLY on the provided transcript, answer the user's question.
        - When referencing information, simply state the fact. **Do NOT mention the title of the current video**, as the user is already watching it.
        - If the transcript doesn't contain the answer, you MUST state that the information is not in the provided video and you cannot answer in Korean. Do not use outside knowledge.

        Transcript:
        ---
        ${context}
        ---`,
        prompt: `User's Question: "${question}"`,
      });

      const answer = llmResponse.text;
      console.log(`[Tutor-Flow] Generated answer.`);

      // 4. Save the chat interaction to both user-specific and global collections
      const newChatId = db.collection('users').doc().id; 
      const userChatRef = db.collection('users').doc(userId).collection('chats').doc(newChatId);
      const globalChatRef = db.collection('chat_logs').doc(newChatId);

      const chatLogData = {
          id: newChatId,
          userId,
          episodeId,
          courseId: episodeData.courseId,
          question,
          answer,
          contextReferences: [context.substring(0, 500)], // Save first 500 chars of context for reference
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      const batch = db.batch();
      batch.set(userChatRef, chatLogData);
      batch.set(globalChatRef, chatLogData);
      await batch.commit();
      
      console.log(`[Tutor-Flow] Saved chat interaction to user-specific and global collections.`);

      return { answer };

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred during AI processing.";
        console.error("[Tutor-Flow-ERROR]", message, error);
        return { answer: `죄송합니다, 답변을 생성하는 중 오류가 발생했습니다. (오류: ${message})` };
    }
  }
);
