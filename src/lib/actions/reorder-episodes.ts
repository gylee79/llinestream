
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

export async function reorderEpisodes(
  courseId: string,
  episodeIds: string[]
): Promise<{ success: boolean; message: string }> {
  if (!courseId || !episodeIds || episodeIds.length === 0) {
    return { success: false, message: '강좌 ID와 에피소드 목록이 필요합니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const batch = db.batch();

    episodeIds.forEach((episodeId, index) => {
      const episodeRef = db.collection('episodes').doc(episodeId);
      batch.update(episodeRef, { orderIndex: index });
    });

    await batch.commit();

    revalidatePath('/admin/content');
    return { success: true, message: '에피소드 순서가 저장되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('reorderEpisodes Error:', errorMessage, error);
    return { success: false, message: `순서 저장 실패: ${errorMessage}` };
  }
}
