'use server';
import { initializeAdminApp } from '@/lib/firebase-admin';

export async function getSignedUrl(filePath: string): Promise<{ signedURL: string } | { error: string }> {
    if (!filePath) {
        return { error: '파일 경로가 필요합니다.' };
    }
    try {
        const adminApp = initializeAdminApp();
        const storage = adminApp.storage();
        const bucket = storage.bucket();

        // Create a signed URL that expires in 15 minutes.
        const [signedURL] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        return { signedURL };
    } catch (error) {
        console.error('Error generating signed URL:', error);
        return { error: '비디오 주소를 가져올 수 없습니다.' };
    }
}
