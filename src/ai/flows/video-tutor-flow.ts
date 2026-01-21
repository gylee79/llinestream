
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
      // Fetch AI settings to determine the scope
      const aiSettingsDoc = await db.collection('settings').doc('aiTutor').get();
      const scope = (aiSettingsDoc.data()?.defaultSearchScope as AiSearchScope) || 'field'; // Default to 'field'
      console.log(`[Tutor-Flow] Using search scope: ${scope}`);

      // 1. Get the full hierarchy for the given episode
      const episodeDoc = await db.collection('episodes').doc(episodeId).get();
      if (!episodeDoc.exists) throw new Error(`Episode with ID ${episodeId} not found.`);
      const episodeData = episodeDoc.data() as Episode;

      const courseDoc = await db.collection('courses').doc(episodeData.courseId).get();
      if (!courseDoc.exists) throw new Error(`Course ${episodeData.courseId} not found.`);
      const courseData = courseDoc.data() as Course;

      const classificationDoc = await db.collection('classifications').doc(courseData.classificationId).get();
      if (!classificationDoc.exists) throw new Error(`Classification ${courseData.classificationId} not found.`);
      const classificationData = classificationDoc.data() as Classification;
      
      const fieldDoc = await db.collection('fields').doc(classificationData.fieldId).get();
      if (!fieldDoc.exists) throw new Error(`Field ${classificationData.fieldId} not found.`);
      const fieldData = fieldDoc.data();

      // 2. Build context based on the selected scope
      let context = "";
      let scopeDescriptionForPrompt = "";
      let query: admin.firestore.Query | null = null;
      
      switch (scope) {
        case 'episode':
            context = episodeData.aiGeneratedContent || "";
            scopeDescriptionForPrompt = `현재 시청중인 '${episodeData.title}' 영상 하나의 내용`;
            console.log(`[Tutor-Flow] Scope: episode. Using content from episode ${episodeId}.`);
            break;
        case 'course':
            query = db.collection('episode_ai_chunks').where('courseId', '==', courseData.id);
            scopeDescriptionForPrompt = `'${courseData.name}' 상세분류에 속한 모든 영상들의 내용`;
            break;
        case 'classification':
            query = db.collection('episode_ai_chunks').where('classificationId', '==', classificationData.id);
            scopeDescriptionForPrompt = `'${classificationData.name}' 큰분류에 속한 모든 영상들의 내용`;
            break;
        case 'field':
        default:
            query = db.collection('episode_ai_chunks').where('fieldId', '==', fieldDoc.id);
            scopeDescriptionForPrompt = `'${fieldData?.name}' 분야에 속한 모든 영상들의 내용`;
            break;
      }
      
      if (query) {
        const querySnapshot = await query.get();
        console.log(`[Tutor-Flow] Scope: ${scope}. Found ${querySnapshot.size} chunks.`);
        if (!querySnapshot.empty) {
            context = querySnapshot.docs
                .map(doc => {
                    const chunkData = doc.data();
                    return `--- Video Content from Episode ID: ${chunkData.episodeId} ---\n${chunkData.content}`;
                })
                .join('\n\n');
        }
      }

      if (!context) {
        const fallbackMessage = "죄송합니다, 현재 선택된 범위에는 답변의 근거가 될 분석 내용이 아직 없습니다. 다른 검색 범위를 선택하거나 잠시 후 다시 시도해주세요."
        console.log(`[Tutor-Flow] No AI-generated content found for scope '${scope}'.`);
        return { answer: fallbackMessage };
      }
      
      // 3. Generate the answer using Gemini with the constructed context
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-1.5-flash-latest'),
        system: `You are a friendly and helpful Korean tutor. You MUST answer all questions in Korean.
        Based ONLY on the following context, which is composed of ${scopeDescriptionForPrompt}, answer the user's question.
        If the context doesn't contain the answer, you MUST state that the information is not in the provided videos and you cannot answer in Korean. Do not use outside knowledge.

        Context:
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
