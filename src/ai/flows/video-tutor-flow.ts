
'use server';
/**
 * @fileOverview AI Tutor flow for answering questions about a video episode.
 *
 * This flow takes a user's question about a specific video episode,
 * searches for relevant context within the video's transcribed text chunks,
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
    let context = "";

    try {
      // 1. Get the hierarchy to find the fieldId
      const episodeDoc = await db.collection('episodes').doc(episodeId).get();
      if (!episodeDoc.exists) throw new Error(`Episode with ID ${episodeId} not found.`);
      const episodeData = episodeDoc.data() as Episode;

      const courseDoc = await db.collection('courses').doc(episodeData.courseId).get();
      if (!courseDoc.exists) throw new Error(`Course ${episodeData.courseId} not found.`);
      const courseData = courseDoc.data() as Course;

      const classificationDoc = await db.collection('classifications').doc(courseData.classificationId).get();
      if (!classificationDoc.exists) throw new Error(`Classification ${courseData.classificationId} not found.`);
      const classificationData = classificationDoc.data() as Classification;
      
      const fieldId = classificationData.fieldId;
      console.log(`[Tutor-Flow] Found Field ID: ${fieldId}`);

      // 2. Get all AI chunks for that field
      const chunksSnapshot = await db.collection('episode_ai_chunks').where('fieldId', '==', fieldId).get();
      
      if (!chunksSnapshot.empty) {
          context = chunksSnapshot.docs
              .map(doc => {
                  const chunkData = doc.data();
                  // Include episode title for better context separation
                  return `--- Video Content from Episode ID: ${chunkData.episodeId} ---\n${chunkData.content}`;
              })
              .join('\n\n');
          console.log(`[Tutor-Flow] Compiled context from ${chunksSnapshot.size} chunks for field ${fieldId}.`);
      } else {
          // Fallback to the single episode's content if no chunks are found (e.g., during migration)
          context = episodeData.aiGeneratedContent || "";
          console.log(`[Tutor-Flow] No AI chunks found for field ${fieldId}, falling back to single episode content.`);
      }

      if (!context) {
        console.log(`[Tutor-Flow] No AI-generated content found for episode ${episodeId} or its field.`);
        return { answer: "죄송합니다, 이 비디오 또는 관련 분야에 대한 분석 내용이 아직 없습니다. 잠시 후 다시 시도해주세요." };
      }
      
      // 3. Generate the answer using Gemini with the broad context
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-3-flash-preview'),
        system: `You are a friendly and helpful Korean tutor. You MUST answer all questions in Korean.
        Based ONLY on the following collection of video analyses from the same category, answer the user's question.
        Each section of the context, separated by '---', is from a different video but they are all related to the same general field.
        If the context doesn't contain the answer, you MUST state that the information is not in the provided videos and you cannot answer in Korean. Do not use outside knowledge.

        Context from video analyses in the same category:
        ---
        ${context}
        ---`,
        prompt: `User's Question: "${question}"`,
      });

      const answer = llmResponse.text;
      console.log(`[Tutor-Flow] Generated answer.`);

      // 4. Save the chat interaction to both user-specific and global collections
      const newChatId = db.collection('users').doc().id; // Generate one ID for both
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
        console.error("[Tutor-Flow-ERROR]", message);
        return { answer: `죄송합니다, 답변을 생성하는 중 오류가 발생했습니다. (오류: ${message})` };
    }
  }
);

    