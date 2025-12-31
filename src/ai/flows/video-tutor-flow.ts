

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
import { z } from 'genkit';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

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
    // 1. Embed the user's question using Genkit's embedder
    console.log(`[Tutor-Flow] Embedding question: "${question}"`);
    const { embedding: questionEmbedding } = await ai.embed({
        embedder: 'googleai/text-embedding-004',
        content: question,
    });

    // 2. Find relevant chunks from Firestore
    console.log(`[Tutor-Flow] Searching for relevant chunks in episode ${episodeId}`);
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    
    const episodeRef = db.collection('episodes').doc(episodeId);
    const episodeDoc = await episodeRef.get();
    if (!episodeDoc.exists || !episodeDoc.data()?.transcript) {
        console.log(`[Tutor-Flow] No transcript found for episode ${episodeId}.`);
        return { answer: "죄송합니다, 이 비디오는 아직 AI 질문에 맞게 처리되지 않았습니다. 관리자에게 문의해주세요." };
    }
    
    // Vector search is a Firestore enterprise feature and might not be available in all projects.
    // For this implementation, we will fetch all chunks and perform a simple cosine similarity calculation.
    // In a production environment with many chunks, using a dedicated vector database or Firestore's native vector search would be more efficient.
    const chunksCollectionRef = episodeRef.collection('chunks');
    const chunksSnapshot = await chunksCollectionRef.get();
    
    if (chunksSnapshot.empty) {
        console.log(`[Tutor-Flow] No chunks found. Responding with default message.`);
        return { answer: "죄송합니다, 이 비디오는 아직 AI 질문에 맞게 처리되지 않았습니다. 관리자에게 문의해주세요." };
    }

    const chunkData = chunksSnapshot.docs.map(doc => ({
        text: doc.data().text as string,
        vector: doc.data().vector as number[]
    }));

    // Simple cosine similarity calculation
    const dotProduct = (vecA: number[], vecB: number[]) => vecA.map((val, i) => val * vecB[i]).reduce((a, b) => a + b, 0);
    const magnitude = (vec: number[]) => Math.sqrt(vec.map(val => val * val).reduce((a, b) => a + b, 0));
    const cosineSimilarity = (vecA: number[], vecB: number[]) => dotProduct(vecA, vecB) / (magnitude(vecA) * magnitude(vecB));

    const similarities = chunkData.map(chunk => ({
        text: chunk.text,
        similarity: cosineSimilarity(questionEmbedding, chunk.vector)
    }));

    // Sort by similarity and get the top 3
    similarities.sort((a, b) => b.similarity - a.similarity);
    const contextChunks = similarities.slice(0, 3).map(s => s.text);
    const context = contextChunks.join('\n\n---\n\n');

    if (contextChunks.length === 0) {
        console.log(`[Tutor-Flow] No relevant chunks found. Responding with default message.`);
        return { answer: "죄송합니다, 비디오 내용에서 질문과 관련된 정보를 찾을 수 없었습니다. 다른 질문을 해주시거나, 이 비디오가 AI 질문에 맞게 처리되었는지 확인해주세요." };
    }

    console.log(`[Tutor-Flow] Found ${contextChunks.length} relevant chunks. Generating answer...`);
    
    // 3. Generate the answer using Gemini
    const llmResponse = await ai.generate({
      prompt: `You are a friendly and helpful tutor. Based on the following video transcript context, answer the user's question in Korean. If the context doesn't contain the answer, say that you don't know.

      Context from the video:
      ---
      ${context}
      ---
      
      User's Question: "${question}"`,
      model: 'googleai/gemini-1.5-flash',
    });

    const answer = llmResponse.text;
    
    // 4. (Optional but recommended) Save the chat interaction
    console.log(`[Tutor-Flow] Saving chat interaction to Firestore.`);
    const chatRef = db.collection('chats').doc();
    await chatRef.set({
        userId,
        episodeId,
        question,
        answer,
        contextReferences: contextChunks,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { answer };
  }
);
