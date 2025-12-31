
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Episode } from '../types';
import { extractScriptWithGemini } from './process-video-google';

/**
 * Processes a video for AI Q&A by transcribing, chunking, and creating embeddings.
 * This now acts as a wrapper for the Gemini-based implementation.
 * @param episodeId The ID of the episode to process.
 * @returns A result object indicating success or failure.
 */
export async function processVideoForAI(episodeId: string): Promise<{ success: boolean; message: string }> {
  console.log(`[AI-Process-Wrapper] Starting video processing for episode: ${episodeId}`);
  
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);

    // 1. Get episode data from Firestore
    const episodeRef = db.collection('episodes').doc(episodeId);
    const episodeDoc = await episodeRef.get();
    if (!episodeDoc.exists) {
      throw new Error(`Episode with ID ${episodeId} not found.`);
    }
    const episode = episodeDoc.data() as Episode;

    // Call the new Gemini-based function
    const result = await extractScriptWithGemini(episodeId, episode.videoUrl);

    if (!result.success) {
      throw new Error(result.message);
    }
    
    // The Gemini function now also handles chunking and saving.
    // If embedding is needed in the future, it can be added here or in the Gemini function.

    return { success: true, message: 'Video processed successfully for AI Q&A using Gemini.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[AI-Process-ERROR]', error);
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  }
}
