'use server';

import 'server-only';
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
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const episodeRef = db.collection('episodes').doc(episodeId);

    const doc = await episodeRef.get();
    if (!doc.exists) {
        return { success: false, message: '해당 에피소드를 찾을 수 없습니다.' };
    }

    await episodeRef.update({
        aiProcessingStatus: 'pending', // Set to 'pending' to re-trigger the unified workflow
        status: { // Also reset the main processing status
            processing: 'pending',
            playable: false,
            error: null,
        },
        aiProcessingError: null,
    });
    
    revalidatePath('/admin/content');

    return { success: true, message: `'${doc.data()?.title}' 에피소드에 대한 AI 분석 및 암호화가 재시작됩니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    console.error(`[AI-Reset-ERROR] for episode ${episodeId}:`, error);
    return { success: false, message: `AI 분석 상태 리셋 실패: ${errorMessage}` };
  }
}
