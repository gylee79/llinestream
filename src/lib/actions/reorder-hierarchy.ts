
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

export async function reorderHierarchyItems(
  collectionName: 'fields' | 'classifications' | 'courses',
  itemIds: string[]
): Promise<{ success: boolean; message: string }> {
  if (!collectionName || !itemIds) { // Allow empty array to clear a group if needed
    return { success: false, message: '컬렉션 이름과 아이템 목록이 필요합니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const batch = db.batch();

    itemIds.forEach((itemId, index) => {
      const itemRef = db.collection(collectionName).doc(itemId);
      batch.update(itemRef, { orderIndex: index });
    });

    await batch.commit();

    revalidatePath('/admin/content');
    return { success: true, message: '순서가 저장되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('reorderHierarchyItems Error:', errorMessage, error);
    return { success: false, message: `순서 저장 실패: ${errorMessage}` };
  }
}
