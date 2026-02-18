
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

/**
 * Resets the video processing pipeline and AI analysis status for an episode.
 * This will trigger the onDocumentWritten Cloud Function to re-process everything.
 * @param episodeId The ID of the episode to reset.
 * @returns A result object indicating success or failure.
 */
export async function resetAIEpisodeStatus(episodeId: string): Promise<{ success: boolean; message: string }> {
  console.log(`[PIPELINE-RESET] Resetting status for episode: ${episodeId}`);
  
  if (!episodeId) {
      return { success: false, message: '에피소드 ID가 필요합니다.' };
  }

  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const episodeRef = db.collection('episodes').doc(episodeId);

    const doc = await episodeRef.get();
    if (!doc.exists) {
        return { success: false, message: '해당 에피소드를 찾을 수 없습니다.' };
    }

    // From Spec 1 & 7: Reset both pipeline and AI status to trigger the whole flow.
    await episodeRef.update({
        'status.pipeline': 'pending',
        'status.step': 'idle',
        'status.error': null,
        'status.playable': false,
        'ai.status': 'pending',
        'ai.error': null,
    });
    
    revalidatePath('/admin/content');

    return { success: true, message: `'${doc.data()?.title}' 에피소드에 대한 전체 재처리 작업이 시작됩니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    console.error(`[PIPELINE-RESET-ERROR] for episode ${episodeId}:`, error);
    return { success: false, message: `재처리 시작 실패: ${errorMessage}` };
  }
}
