'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

export async function getVttContent(filePath: string): Promise<{ content?: string; error?: string }> {
    if (!filePath) {
        return { error: '파일 경로가 필요합니다.' };
    }
    try {
        const adminApp = await initializeAdminApp();
        const storage = admin.storage(adminApp);
        const bucket = storage.bucket();

        const file = bucket.file(filePath);
        const [exists] = await file.exists();
        if (!exists) {
            return { error: '자막 파일을 찾을 수 없습니다.' };
        }

        const [content] = await file.download();
        
        return { content: content.toString('utf-8') };
    } catch (error) {
        console.error('Error fetching VTT content:', error);
        return { error: '자막 내용을 가져오는 데 실패했습니다.' };
    }
}
