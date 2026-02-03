'use server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

export async function getSignedUrl(filePath: string): Promise<{ signedURL: string } | { error: string }> {
    if (!filePath) {
        return { error: '파일 경로가 필요합니다.' };
    }
    try {
        await initializeAdminApp();
        const storage = admin.storage();
        const bucket = storage.bucket();

        // Create a signed URL that expires in 1 hour.
        const [signedURL] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        return { signedURL };
    } catch (error) {
        console.error('Error generating signed URL:', error);
        return { error: '보안 링크를 생성할 수 없습니다.' };
    }
}
