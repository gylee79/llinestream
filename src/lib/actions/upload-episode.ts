
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import { v4 as uuidv4 } from 'uuid';
import { Episode } from '../types';

type UploadResult = {
  success: boolean;
  message: string;
};

async function getVideoDuration(fileBuffer: Buffer): Promise<number> {
    // This is a placeholder. In a real scenario, you'd use a library like fluent-ffmpeg
    // on the server to get the video duration. For now, returning a mock duration.
    // const ffmpeg = require('fluent-ffmpeg');
    // return new Promise((resolve, reject) => { ... });
    return Math.floor(Math.random() * (3600 - 60 + 1)) + 60; // Random duration between 60s and 1hr
}

async function uploadFileToStorage(
    storage: admin.storage.Storage,
    path: string,
    fileBuffer: Buffer,
    contentType: string
): Promise<string> {
    const bucket = storage.bucket();
    const file = bucket.file(path);

    await file.save(fileBuffer, {
        metadata: { contentType },
        public: true, // Make file public
    });
    
    // Return the public URL
    return file.publicUrl();
}

export async function uploadEpisode(formData: FormData): Promise<UploadResult> {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const isFree = formData.get('isFree') === 'true';
    const selectedCourseId = formData.get('selectedCourseId') as string;
    const videoFile = formData.get('videoFile') as File | null;

    if (!title || !selectedCourseId || !videoFile) {
        return { success: false, message: '필수 정보(제목, 강좌, 비디오 파일)가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);

        const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
        const episodeId = uuidv4();
        
        // 1. Upload Video File
        const videoPath = `courses/${selectedCourseId}/episodes/${episodeId}/${videoFile.name}`;
        const videoUrl = await uploadFileToStorage(storage, videoPath, videoBuffer, videoFile.type);

        // 2. Get video duration (mocked for now)
        const duration = await getVideoDuration(videoBuffer);

        // 3. Create Firestore document
        const episodeRef = db.collection('courses').doc(selectedCourseId).collection('episodes').doc(episodeId);
        
        // Thumbnail is no longer auto-generated. It should be uploaded separately by the user.
        const newEpisode: Omit<Episode, 'id'> = {
            courseId: selectedCourseId,
            title,
            description,
            duration,
            isFree,
            videoUrl,
            thumbnailUrl: '', // Initially empty
            thumbnailHint: '', // Initially empty
        };

        await episodeRef.set(newEpisode);

        revalidatePath('/admin/content');
        return { success: true, message: `에피소드 '${title}'가 성공적으로 업로드되었습니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('Episode Upload Error:', errorMessage, error);
        return { success: false, message: `업로드 실패: ${errorMessage}` };
    }
}
