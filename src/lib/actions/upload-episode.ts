
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import { v4 as uuidv4 } from 'uuid';
import type { Episode, Timestamp } from '../types';
import { Storage } from 'firebase-admin/storage';


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
    episodeId: string;
    title: string;
    description: string;
    isFree: boolean;
    selectedCourseId: string;
    videoUrl: string;
    filePath: string;
    thumbnailUrl: string;
    thumbnailPath: string | undefined;
}

type UpdateEpisodePayload = {
    episodeId: string;
    courseId: string;
    title: string;
    description: string;
    isFree: boolean;
    thumbnailUrl: string;
    thumbnailPath: string | undefined;
    newVideoData?: {
        videoUrl: string;
        filePath: string;
    };
    oldFilePath?: string;
}

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) {
        console.warn(`[SKIP DELETE] No file path provided.`);
        return;
    }
    try {
        const file = storage.bucket().file(filePath);
        const [exists] = await file.exists();
        if (exists) {
            console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
            await file.delete();
            console.log(`[DELETE SUCCESS] File deleted: ${filePath}`);
        } else {
            console.log(`[SKIP DELETE] File does not exist, skipping deletion: ${filePath}`);
        }
    } catch (error: any) {
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
        // Do not re-throw, as this shouldn't block the main operation.
    }
};


/**
 * Generates a signed URL that allows the client to directly upload a file to Firebase Storage.
 */
export async function getSignedUploadUrl(fileName: string, fileType: string, episodeId: string, itemType: 'videos' | 'thumbnails'): Promise<SignedUrlResult> {
    if (!fileName || !fileType) {
        return { success: false, message: '파일 이름, 파일 타입은 필수입니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const storage = admin.storage(adminApp);
        const bucket = storage.bucket();

        const filePath = `episodes/${episodeId}/${itemType}/${Date.now()}-${fileName}`;
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


/**
 * Saves the metadata of an already uploaded episode to Firestore.
 */
export async function saveEpisodeMetadata(payload: SaveMetadataPayload): Promise<UploadResult> {
    const { episodeId, title, description, isFree, selectedCourseId, videoUrl, filePath, thumbnailUrl, thumbnailPath } = payload;
     if (!title || !selectedCourseId || !videoUrl || !episodeId || !filePath) {
        return { success: false, message: '필수 정보(에피소드ID, 제목, 강좌, 비디오 URL, 파일 경로)가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);
        
        // Make the newly uploaded file public
        const file = storage.bucket().file(filePath);
        await file.makePublic();
        console.log(`[PUBLIC SUCCESS] File made public: ${filePath}`);

        if (thumbnailPath) {
          const thumbFile = storage.bucket().file(thumbnailPath);
          await thumbFile.makePublic();
          console.log(`[PUBLIC SUCCESS] Thumbnail file made public: ${thumbnailPath}`);
        }

        // Mock duration for now, as we can't analyze the file on the server anymore.
        const duration = Math.floor(Math.random() * (3600 - 60 + 1)) + 60;
        
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const newEpisode = {
            courseId: selectedCourseId,
            title,
            description,
            duration,
            isFree,
            videoUrl, // Already contains the public URL
            filePath,
            thumbnailUrl: thumbnailUrl,
            thumbnailPath: thumbnailPath,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await episodeRef.set(newEpisode);

        revalidatePath('/admin/content', 'layout');
        return { success: true, message: `에피소드 '${title}'의 정보가 성공적으로 저장되었습니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('saveEpisodeMetadata Error:', errorMessage, error);
        return { success: false, message: `메타데이터 저장 실패: ${errorMessage}` };
    }
}

/**
 * Updates an existing episode's metadata and optionally replaces its video file.
 */
export async function updateEpisode(payload: UpdateEpisodePayload): Promise<UploadResult> {
    const { episodeId, courseId, title, description, isFree, thumbnailUrl, thumbnailPath, newVideoData, oldFilePath } = payload;
    
    if (!episodeId || !courseId || !title) {
        return { success: false, message: '에피소드 ID, 강좌 ID, 제목은 필수입니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);
        const episodeRef = db.collection('episodes').doc(episodeId);

        // If a new video was uploaded, delete the old one.
        if (newVideoData && oldFilePath) {
            console.log(`[UPDATE] New video provided. Deleting old file: ${oldFilePath}`);
            await deleteStorageFileByPath(storage, oldFilePath);
        }

        const dataToUpdate: Partial<Episode> = {
            title,
            description,
            isFree,
            courseId,
            thumbnailUrl,
            thumbnailPath,
        };

        if (newVideoData) {
            // Make the new file public before saving its URL
            const file = storage.bucket().file(newVideoData.filePath);
            await file.makePublic();
            console.log(`[PUBLIC SUCCESS] New video file made public: ${newVideoData.filePath}`);

            dataToUpdate.videoUrl = newVideoData.videoUrl;
            dataToUpdate.filePath = newVideoData.filePath;
            // You might want to update duration here if you can get it from the new video
        }

        await episodeRef.update(dataToUpdate);

        revalidatePath('/admin/content', 'layout');
        return { success: true, message: `에피소드 '${title}' 정보가 업데이트되었습니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('updateEpisode Error:', errorMessage, error);
        return { success: false, message: `에피소드 업데이트 실패: ${errorMessage}` };
    }
}
