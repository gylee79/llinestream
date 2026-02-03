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
    
    // This helper function processes the raw analysis JSON string to remove milliseconds from timestamps
    const processAnalysisContent = (content: string) => {
        try {
            const analysis = JSON.parse(content);
            if (analysis.timeline && Array.isArray(analysis.timeline)) {
                analysis.timeline = analysis.timeline.map((item: any) => ({
                    ...item,
                    startTime: removeMilliseconds(item.startTime),
                    endTime: removeMilliseconds(item.endTime),
                }));
            }
            return analysis;
        } catch (e) {
            // If parsing fails, just return a summary object to avoid breaking the flow.
            return { summary: content };
        }
    };
    
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

      // New: Fetch all episodes once to create a title map
      const allEpisodesSnapshot = await db.collection('episodes').get();
      const episodeTitleMap = new Map<string, string>();
      allEpisodesSnapshot.forEach(doc => {
          episodeTitleMap.set(doc.id, doc.data().title);
      });

      // 2. Build context based on the selected scope
      let context = "";
      let query: admin.firestore.Query | null = null;
      
      switch (scope) {
        case 'episode':
            // This case is handled below, as it doesn't need a query
            break;
        case 'course':
            query = db.collection('episode_ai_chunks').where('courseId', '==', courseData.id);
            break;
        case 'classification':
            query = db.collection('episode_ai_chunks').where('classificationId', '==', classificationData.id);
            break;
        case 'field':
        default:
            query = db.collection('episode_ai_chunks').where('fieldId', '==', fieldDoc.id);
            break;
      }
      
      if (query) {
        const querySnapshot = await query.get();
        console.log(`[Tutor-Flow] Scope: ${scope}. Found ${querySnapshot.size} chunks.`);
        if (!querySnapshot.empty) {
            const chunks = querySnapshot.docs.map(doc => {
                const chunkData = doc.data();
                return {
                    episodeId: chunkData.episodeId,
                    episodeTitle: episodeTitleMap.get(chunkData.episodeId) || '알 수 없는 영상',
                    analysis: processAnalysisContent(chunkData.content)
                };
            });
            context = JSON.stringify(chunks, null, 2);
        }
      } else if (scope === 'episode' && episodeData.aiGeneratedContent) {
           console.log(`[Tutor-Flow] Scope: episode. Using content from episode ${episodeId}.`);
           context = JSON.stringify([{
              episodeId: episodeId,
              episodeTitle: episodeData.title,
              analysis: processAnalysisContent(episodeData.aiGeneratedContent)
           }], null, 2);
      }


      if (!context) {
        const fallbackMessage = "죄송합니다, 현재 선택된 범위에는 답변의 근거가 될 분석 내용이 아직 없습니다. 다른 검색 범위를 선택하거나 잠시 후 다시 시도해주세요."
        console.log(`[Tutor-Flow] No AI-generated content found for scope '${scope}'.`);
        return { answer: fallbackMessage };
      }
      
      // 3. Generate the answer using Gemini with the constructed context
      const llmResponse = await ai.generate({
        model: googleAI.model('gemini-2.5-flash'),
        system: `You are a friendly and helpful Korean AI Tutor. You MUST answer all questions in Korean.
        You will be given a JSON object or an array of JSON objects as context. Each object represents the detailed analysis of a video, including 'episodeId', 'episodeTitle', and 'analysis' (which contains transcript, summary, timeline, etc.).
        The user is currently watching the episode titled '${episodeData.title}'.

        Based ONLY on the provided JSON context, answer the user's question.
        - When referencing information from the *currently playing video*, simply state "이 영상에서는..." or "현재 영상에서는...". **Do NOT mention the title of the current video**, as the user is already watching it. For example, instead of saying "현재 영상인 '영상 제목'에서는...", you MUST say "이 영상에서는...".
        - IMPORTANT: When citing timestamps, you MUST format them as HH:MM:SS and exclude any milliseconds. For example, use "00:01:23초" instead of "00:01:23.456초". For a time range, use a format like "00:01:23초 - 00:01:45초".
        - When referencing information from a *different video*, you MUST state the name of that video using the 'episodeTitle' field. For example: "네, 관련 내용이 '${"다른 영상 제목"}' 편에 있습니다."
        - Analyze the structured data, especially the 'timeline' for time-specific events and descriptions.
        - If the context doesn't contain the answer, you MUST state that the information is not in the provided videos and you cannot answer in Korean. Do not use outside knowledge.

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
