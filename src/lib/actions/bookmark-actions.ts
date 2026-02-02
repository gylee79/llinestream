
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { User, Episode } from '@/lib/types';

interface AddBookmarkPayload {
    userId: string;
    episodeId: string;
    courseId: string;
    timestamp: number;
    note: string;
}

export async function addBookmark(payload: AddBookmarkPayload): Promise<{ success: boolean; message: string; bookmarkId?: string; }> {
    const { userId, episodeId, courseId, timestamp, note } = payload;
    if (!userId || !episodeId || !courseId) {
        return { success: false, message: '사용자, 에피소드, 강좌 ID는 필수입니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) throw new Error('사용자를 찾을 수 없습니다.');
        const user = userDoc.data() as User;

        const episodeDoc = await db.collection('episodes').doc(episodeId).get();
        if (!episodeDoc.exists) throw new Error('에피소드를 찾을 수 없습니다.');
        const episode = episodeDoc.data() as Episode;

        const batch = db.batch();
        const bookmarkId = db.collection('bookmarks').doc().id;

        const bookmarkData = {
            id: bookmarkId,
            userId,
            episodeId,
            courseId,
            timestamp,
            note,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            // Denormalized data for admin view
            userName: user.name,
            userEmail: user.email,
            episodeTitle: episode.title,
        };

        const userBookmarkRef = db.collection('users').doc(userId).collection('bookmarks').doc(bookmarkId);
        batch.set(userBookmarkRef, bookmarkData);

        const globalBookmarkRef = db.collection('bookmarks').doc(bookmarkId);
        batch.set(globalBookmarkRef, bookmarkData);

        await batch.commit();
        
        revalidatePath(`/admin/bookmarks`);

        return { success: true, message: '북마크가 성공적으로 추가되었습니다.', bookmarkId };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
        console.error("addBookmark Error:", error, payload);
        return { success: false, message: `북마크 추가 실패: ${errorMessage}` };
    }
}


export async function deleteBookmark(userId: string, bookmarkId: string): Promise<{ success: boolean; message: string }> {
    if (!userId || !bookmarkId) {
        return { success: false, message: '사용자 ID와 북마크 ID가 필요합니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const batch = db.batch();
        
        const userBookmarkRef = db.collection('users').doc(userId).collection('bookmarks').doc(bookmarkId);
        batch.delete(userBookmarkRef);

        const globalBookmarkRef = db.collection('bookmarks').doc(bookmarkId);
        batch.delete(globalBookmarkRef);

        await batch.commit();

        revalidatePath(`/admin/bookmarks`);

        return { success: true, message: '북마크가 삭제되었습니다.' };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
        console.error("deleteBookmark Error:", error);
        return { success: false, message: `북마크 삭제 실패: ${errorMessage}` };
    }
}
