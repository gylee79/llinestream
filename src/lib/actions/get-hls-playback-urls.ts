
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

interface PlaybackUrls {
    manifestUrl: string;
    keyUrl: string;
}

interface PlaybackError {
    error: string;
}

/**
 * Generates short-lived signed URLs for HLS manifest and its encryption key.
 * This function should be called by the client right before playback.
 * @param episodeId The ID of the episode to generate URLs for.
 * @returns A promise that resolves to an object containing signed URLs for manifest and key, or an error object.
 */
export async function getHlsPlaybackUrls(episodeId: string): Promise<PlaybackUrls | PlaybackError> {
    if (!episodeId) {
        return { error: '에피소드 ID가 필요합니다.' };
    }

    try {
        const adminApp = await initializeAdminApp();
        const storage = admin.storage(adminApp);
        const bucket = storage.bucket();

        // Define paths to the manifest and the key
        const manifestPath = `episodes/${episodeId}/packaged/manifest.m3u8`;
        const keyPath = `episodes/${episodeId}/keys/enc.key`;

        const manifestFile = bucket.file(manifestPath);
        const keyFile = bucket.file(keyPath);

        // Check if both files exist before generating URLs
        const [manifestExists] = await manifestFile.exists();
        const [keyExists] = await keyFile.exists();

        if (!manifestExists || !keyExists) {
            console.error(`[getHlsPlaybackUrls] Missing required files for episode ${episodeId}. Manifest exists: ${manifestExists}, Key exists: ${keyExists}`);
            return { error: '스트리밍에 필요한 파일이 준비되지 않았습니다. 영상 처리 상태를 확인해주세요.' };
        }

        // Generate signed URLs that expire in 1 hour (enough for one viewing session)
        const expires = Date.now() + 60 * 60 * 1000; // 1 hour
        
        const [manifestUrl] = await manifestFile.getSignedUrl({
            action: 'read',
            expires,
        });
        
        const [keyUrl] = await keyFile.getSignedUrl({
            action: 'read',
            expires,
        });

        console.log(`[getHlsPlaybackUrls] Successfully generated signed URLs for episode ${episodeId}.`);
        return { manifestUrl, keyUrl };

    } catch (error) {
        console.error(`[getHlsPlaybackUrls] Error generating signed URLs for episode ${episodeId}:`, error);
        return { error: '영상 재생에 필요한 보안 링크를 생성하는 데 실패했습니다.' };
    }
}
