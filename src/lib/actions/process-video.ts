'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

/**
 * Resets the AI processing status of an episode to 'pending'.
 * This will trigger the onDocumentWritten Cloud Function to re-process the video.
 * @param episodeId The ID of the episode to reset.
 * @returns A result object indicating success or failure.
 */
export async function resetAIEpisodeStatus(episodeId: string): Promise<{ success: boolean; message: string }> {
  console.log(`[AI-Reset] Resetting status for episode: ${episodeId}`);
  
  if (!episodeId) {
      return { success: false, message: '에피소드 ID가 필요합니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const episodeRef = db.collection('episodes').doc(episodeId);

    await episodeRef.update({
        aiProcessingStatus: 'pending',
        aiProcessingError: null,
    });
    
    revalidatePath('/admin/content');

    return { success: true, message: `'${episodeId}' 에피소드에 대한 AI 분석이 재시작됩니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    console.error(`[AI-Reset-ERROR] for episode ${episodeId}:`, error);
    return { success: false, message: `AI 분석 상태 리셋 실패: ${errorMessage}` };
  }
}
