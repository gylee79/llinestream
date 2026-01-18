
'use server';
/**
 * @fileOverview AI Tutor flow for answering questions about a video episode.
 *
 * This flow takes a user's question about a specific video episode,
 * searches for relevant context within the video's transcribed text chunks,
 * and generates a helpful answer based on that context.
 *
 * - askVideoTutor - A function that handles the question-answering process.
 * - VideoTutorInput - The input type for the askVideoTutor function.
 * - VideoTutorOutput - The return type for the askVideoTutor function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Course, Classification, Episode } from '@/lib/types';

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
  return videoTutorFlow(input);
}

const videoTutorFlow = ai.defineFlow(
  {
    name: 'videoTutorFlow',
    inputSchema: VideoTutorInputSchema,
    outputSchema: VideoTutorOutputSchema,
  },
  async ({ episodeId, question, userId }) => {
    console.log(`[Tutor-Flow] Starting for episode ${episodeId} with question: "${question}"`);

    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);

    try {
      // 1. Get the AI-generated content from the episode document
      const episodeDoc = await db.collection('episodes').doc(episodeId).get();
      if (!episodeDoc.exists) {
          throw new Error(`Episode with ID ${episodeId} not found.`);
      }
      const episodeData = episodeDoc.data() as Episode;
      const context = episodeData.aiGeneratedContent;

      if (!context) {
        console.log(`[Tutor-Flow] No AI-generated content found for episode ${episodeId}.`);
        return { answer: "죄송합니다, 이 비디오는 아직 AI 질문에 맞게 처리되지 않았습니다. 잠시 후 다시 시도해주세요." };
      }
      
      console.log(`[Tutor-Flow] Found AI-generated content for context for episode ${episodeId}.`);

      // 2. Generate the answer using Gemini with the provided context (Context Caching applied)
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-2.5-flash'),
        system: `You are a friendly and helpful Korean tutor. You MUST answer all questions in Korean.
        Based ONLY on the following video content analysis, answer the user's question.
        The context includes a summary and a description of visual elements from the video.
        If the context doesn't contain the answer, you MUST state that the information is not in the video and you cannot answer in Korean. Do not use outside knowledge.

        Context from the video:
        ---
        ${context}
        ---`,
        prompt: `User's Question: "${question}"`,
        config: {
          thinkingConfig: {
            thinkingBudget: 8192,
            includeThoughts: true,
          },
        }
      });

      if (llmResponse.reasoning) {
        console.log('Reasoning:', llmResponse.reasoning);
      }

      const answer = llmResponse.text;
      console.log(`[Tutor-Flow] Generated answer.`);

      // 3. Save the chat interaction only to the user's sub-collection
      const newChatId = db.collection('users').doc(userId).collection('chats').doc().id;
      const userChatRef = db.collection('users').doc(userId).collection('chats').doc(newChatId);

      const chatLogData = {
          userId,
          episodeId,
          courseId: episodeData.courseId,
          question,
          answer,
          contextReferences: [context.substring(0, 500)], // Save first 500 chars of context for reference
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await userChatRef.set(chatLogData);
      console.log(`[Tutor-Flow] Saved chat interaction to user-specific collection.`);

      return { answer };

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred during AI processing.";
        console.error("[Tutor-Flow-ERROR]", message);
        return { answer: `죄송합니다, 답변을 생성하는 중 오류가 발생했습니다. (오류: ${message})` };
    }
  }
);
