
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Episode } from '../types';
import { extractScriptWithGemini } from './process-video-google';
import { revalidatePath } from 'next/cache';

/**
 * Processes a video for AI Q&A by transcribing, chunking, and creating embeddings.
 * This now acts as a wrapper for the Gemini-based implementation.
 * @param episodeId The ID of the episode to process.
 * @returns A result object indicating success or failure.
 */
export async function processVideoForAI(episodeId: string, videoUrl?: string): Promise<{ success: boolean; message: string }> {
  console.log(`[AI-Process-Wrapper] Starting video processing for episode: ${episodeId}`);
  
  const adminApp = initializeAdminApp();
  const db = admin.firestore(adminApp);
  const episodeRef = db.collection('episodes').doc(episodeId);

  try {
    
    let urlToProcess = videoUrl;

    if (!urlToProcess) {
        // 1. Get episode data from Firestore if URL is not provided
        const episodeDoc = await episodeRef.get();
        if (!episodeDoc.exists) {
          throw new Error(`Episode with ID ${episodeId} not found.`);
        }
        const episode = episodeDoc.data() as Episode;
        urlToProcess = episode.videoUrl;
    }
    
    if (!urlToProcess) {
        throw new Error(`Video URL for episode ${episodeId} is missing.`);
    }

    // Immediately update status to 'processing'
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });

    // Call the new Gemini-based function
    const result = await extractScriptWithGemini(episodeId, urlToProcess);

    if (!result.success) {
      throw new Error(result.message);
    }
    
    // The Gemini function now also handles chunking and saving.
    // Firestore update is also handled within `extractScriptWithGemini`, including success status.

    revalidatePath('/admin/content', 'layout');
    return { success: true, message: 'Video processed successfully for AI Q&A using Gemini.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error(`[AI-Process-ERROR] for episode ${episodeId}:`, error);
    
    try {
        await episodeRef.update({ aiProcessingStatus: 'failed', aiProcessingError: errorMessage });
        revalidatePath('/admin/content', 'layout');
    } catch (dbError) {
        console.error(`[AI-Process-ERROR] Also failed to write error status to Firestore for episode ${episodeId}:`, dbError);
    }
    
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  }
}
