

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
import { z } from 'zod';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Episode, Course, Classification } from '@/lib/types';


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

    // 1. Find relevant chunks from the specific episode's subcollection in Firestore
    const chunksSnapshot = await db.collection('episodes').doc(episodeId).collection('chunks').get();
    
    if (chunksSnapshot.empty) {
        console.log(`[Tutor-Flow] No chunks found for episode ${episodeId}.`);
        return { answer: "죄송합니다, 이 비디오는 아직 AI 질문에 맞게 처리되지 않았습니다. 다른 비디오를 선택해주세요." };
    }

    const episodeChunks = chunksSnapshot.docs.map(doc => doc.data().text as string);
    const context = episodeChunks.join('\n\n---\n\n');
    console.log(`[Tutor-Flow] Found ${episodeChunks.length} chunks for context.`);

    // 2. Generate the answer using Gemini with the provided context
    const llmResponse = await ai.generate({
      prompt: `You are a friendly and helpful tutor. Based ONLY on the following video transcript context, answer the user's question in Korean.
      If the context doesn't contain the answer, you MUST state that the information is not in the video and you cannot answer. Do not use outside knowledge.

      Context from the video:
      ---
      ${context}
      ---
      
      User's Question: "${question}"`,
      model: 'googleai/gemini-pro', // Using the recommended standard model
    });

    const answer = llmResponse.text;
    console.log(`[Tutor-Flow] Generated answer.`);

    // 3. Save the chat interaction to Firestore
    const chatRef = db.collection('chats').doc();
    await chatRef.set({
        userId,
        episodeId,
        question,
        answer,
        contextReferences: episodeChunks.slice(0, 5), // Save first 5 chunks for reference
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Tutor-Flow] Saved chat interaction to Firestore.`);


    return { answer };
  }
);
