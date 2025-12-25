'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import { v4 as uuidv4 } from 'uuid';
import { Episode } from '../types';

type UploadResult = {
  success: boolean;
  message: string;
};

type SignedUrlResult = {
    success: boolean;
    message: string;
    uploadUrl?: string;
    downloadUrl?: string;
    filePath?: string;
}

type SaveMetadataPayload = {
    title: string;
    description: string;
    isFree: boolean;
    selectedCourseId: string;
    videoUrl: string;
    filePath: string;
}

/**
 * Generates a signed URL that allows the client to directly upload a file to Firebase Storage.
 */
export async function getSignedUploadUrl(courseId: string, fileName: string, fileType: string): Promise<SignedUrlResult> {
    if (!courseId || !fileName || !fileType) {
        return { success: false, message: '강좌 ID, 파일 이름, 파일 타입은 필수입니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const storage = admin.storage(adminApp);
        const bucket = storage.bucket();

        const episodeId = uuidv4();
        const filePath = `courses/${courseId}/episodes/${episodeId}/${fileName}`;
        const file = bucket.file(filePath);

        // Generate a v4 signed URL for PUT requests
        const [uploadUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: fileType,
        });

        // The public URL for the file after it's uploaded
        const downloadUrl = file.publicUrl();

        return {
            success: true,
            message: '업로드 URL이 생성되었습니다.',
            uploadUrl,
            downloadUrl,
            filePath
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('getSignedUploadUrl Error:', errorMessage, error);
        return { success: false, message: `서명된 URL 생성 실패: ${errorMessage}` };
    }
}


async function getVideoDuration(fileBuffer: Buffer): Promise<number> {
    // This is a placeholder. In a real scenario, you'd use a library like fluent-ffmpeg
    // on the server to get the video duration. For now, returning a mock duration.
    return Math.floor(Math.random() * (3600 - 60 + 1)) + 60; // Random duration between 60s and 1hr
}

/**
 * Saves the metadata of an already uploaded episode to Firestore.
 */
export async function saveEpisodeMetadata(payload: SaveMetadataPayload): Promise<UploadResult> {
    const { title, description, isFree, selectedCourseId, videoUrl } = payload;
     if (!title || !selectedCourseId || !videoUrl) {
        return { success: false, message: '필수 정보(제목, 강좌, 비디오 URL)가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        
        // Mock duration for now, as we can't analyze the file on the server anymore.
        const duration = Math.floor(Math.random() * (3600 - 60 + 1)) + 60;
        
        const episodeRef = db.collection('courses').doc(selectedCourseId).collection('episodes').doc();
        
        const newEpisode: Omit<Episode, 'id'> = {
            courseId: selectedCourseId,
            title,
            description,
            duration,
            isFree,
            videoUrl,
            thumbnailUrl: '',
            thumbnailHint: '',
        };

        await episodeRef.set(newEpisode);

        revalidatePath('/admin/content');
        return { success: true, message: `에피소드 '${title}'의 정보가 성공적으로 저장되었습니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('saveEpisodeMetadata Error:', errorMessage, error);
        return { success: false, message: `메타데이터 저장 실패: ${errorMessage}` };
    }
}
