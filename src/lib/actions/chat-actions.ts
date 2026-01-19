'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

export async function deleteChatLog(userId: string, chatId: string): Promise<{ success: boolean; message: string }> {
  if (!userId || !chatId) {
    return { success: false, message: '사용자 ID와 채팅 ID가 제공되지 않았습니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    
    // Create a batch to delete from both locations atomically
    const batch = db.batch();

    // Reference to the log in the user's private subcollection
    const userChatRef = db.collection('users').doc(userId).collection('chats').doc(chatId);
    batch.delete(userChatRef);

    // Reference to the log in the global collection
    const globalChatRef = db.collection('chat_logs').doc(chatId);
    batch.delete(globalChatRef);
    
    await batch.commit();
    
    // Revalidate the admin chats page to reflect the deletion
    revalidatePath('/admin/chats');

    return { success: true, message: '채팅 기록이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('deleteChatLog Error:', errorMessage, error);
    return { success: false, message: `채팅 기록 삭제 실패: ${errorMessage}` };
  }
}

    