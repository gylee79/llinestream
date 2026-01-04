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
      // 1. Get the current episode to find its hierarchy (Field > Classification > Course)
      const episodeDoc = await db.collection('episodes').doc(episodeId).get();
      if (!episodeDoc.exists) throw new Error(`Episode ${episodeId} not found.`);
      const episodeData = episodeDoc.data() as Episode;

      const courseDoc = await db.collection('courses').doc(episodeData.courseId).get();
      if (!courseDoc.exists) throw new Error(`Course ${episodeData.courseId} not found.`);
      const courseData = courseDoc.data() as Course;

      const classDoc = await db.collection('classifications').doc(courseData.classificationId).get();
      if (!classDoc.exists) throw new Error(`Classification ${courseData.classificationId} not found.`);
      const classData = classDoc.data() as Classification;
      
      const targetFieldId = classData.fieldId;
      console.log(`[Tutor-Flow] Target Field ID: ${targetFieldId}`);

      // 2. Find all episodes within the same field
      const classificationsInField = await db.collection('classifications').where('fieldId', '==', targetFieldId).get();
      const classificationIds = classificationsInField.docs.map(doc => doc.id);

      if (classificationIds.length === 0) {
        throw new Error(`No classifications found for Field ID ${targetFieldId}`);
      }

      const coursesInField = await db.collection('courses').where('classificationId', 'in', classificationIds).get();
      const courseIds = coursesInField.docs.map(doc => doc.id);

      if (courseIds.length === 0) {
        throw new Error(`No courses found for the classifications.`);
      }

      const episodesInField = await db.collection('episodes').where('courseId', 'in', courseIds).get();
      const episodeIdsInField = episodesInField.docs.map(doc => doc.id);
      
      console.log(`[Tutor-Flow] Found ${episodeIdsInField.length} episodes in the same field.`);

      // 3. Gather all chunks from all related episodes
      const chunkPromises = episodeIdsInField.map(id => 
        db.collection('episodes').doc(id).collection('chunks').get()
      );
      const chunkSnapshots = await Promise.all(chunkPromises);

      const allChunks = chunkSnapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data().text as string));

      if (allChunks.length === 0) {
        console.log(`[Tutor-Flow] No chunks found for any episode in field ${targetFieldId}.`);
        return { answer: "죄송합니다, 관련 비디오가 아직 AI 질문에 맞게 처리되지 않았습니다." };
      }
      
      const context = allChunks.join('\n\n---\n\n');
      console.log(`[Tutor-Flow] Found ${allChunks.length} total chunks for context.`);


      // 4. Generate the answer using Gemini with the provided context
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-pro'),
        prompt: `You are a friendly and helpful tutor. Based ONLY on the following video transcript context, answer the user's question in Korean.
        If the context doesn't contain the answer, you MUST state that the information is not in the video and you cannot answer. Do not use outside knowledge.

        Context from the video:
        ---
        ${context}
        ---
        
        User's Question: "${question}"`,
      });

      const answer = llmResponse.text;
      console.log(`[Tutor-Flow] Generated answer.`);

      // 5. Save the chat interaction only to the user's sub-collection
      const newChatId = db.collection('users').doc(userId).collection('chats').doc().id;
      const userChatRef = db.collection('users').doc(userId).collection('chats').doc(newChatId);

      const chatLogData = {
          userId,
          episodeId,
          question,
          answer,
          contextReferences: allChunks.slice(0, 5), // Save first 5 chunks for reference
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
