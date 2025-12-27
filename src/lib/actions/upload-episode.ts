
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Episode, Timestamp } from '../types';
import { Storage } from 'firebase-admin/storage';


type UploadResult = {
  success: boolean;
  message: string;
};

type SaveMetadataPayload = {
    episodeId: string;
    title: string;
    description: string;
    isFree: boolean;
    selectedCourseId: string;
    instructorId?: string;
    videoUrl: string;
    filePath: string;
    thumbnailUrl: string;
    thumbnailPath: string;
}

type UpdateEpisodePayload = {
    episodeId: string;
    courseId: string;
    instructorId?: string;
    title: string;
    description: string;
    isFree: boolean;
    newThumbnailData?: {
        downloadUrl: string;
        filePath: string;
    };
    newVideoData?: {
        downloadUrl: string;
        filePath: string;
    };
    oldFilePath?: string;
    oldThumbnailPath?: string;
}

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) {
        console.log(`[SKIP DELETE] No file path provided.`);
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
    }
};


/**
 * Saves the metadata of an already uploaded episode to Firestore.
 */
export async function saveEpisodeMetadata(payload: SaveMetadataPayload): Promise<UploadResult> {
    const { episodeId, title, description, isFree, selectedCourseId, instructorId, videoUrl, filePath, thumbnailUrl, thumbnailPath } = payload;
     if (!title || !selectedCourseId || !videoUrl || !episodeId || !filePath) {
        return { success: false, message: '필수 정보(에피소드ID, 제목, 강좌, 비디오 URL, 파일 경로)가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        
        // Mock duration for now. A more robust solution might involve a Cloud Function
        // that analyzes the video upon upload to get the actual duration.
        const duration = Math.floor(Math.random() * (3600 - 60 + 1)) + 60;
        
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const newEpisode: Omit<Episode, 'id'> = {
            courseId: selectedCourseId,
            instructorId: instructorId || undefined,
            title,
            description,
            duration,
            isFree,
            videoUrl,
            filePath,
            thumbnailUrl: thumbnailUrl,
            thumbnailPath: thumbnailPath,
            createdAt: admin.firestore.FieldValue.serverTimestamp() as Timestamp,
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
 * Updates an existing episode's metadata and handles deletion of old files.
 */
export async function updateEpisode(payload: UpdateEpisodePayload): Promise<UploadResult> {
    const { episodeId, courseId, instructorId, title, description, isFree, newThumbnailData, newVideoData, oldFilePath, oldThumbnailPath } = payload;
    
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
        
        // If a new thumbnail was uploaded, delete the old one.
        if (newThumbnailData && oldThumbnailPath) {
             console.log(`[UPDATE] New thumbnail provided. Deleting old thumbnail: ${oldThumbnailPath}`);
             await deleteStorageFileByPath(storage, oldThumbnailPath);
        }

        const dataToUpdate: { [key: string]: any } = {
            title,
            description,
            isFree,
            courseId,
            instructorId: instructorId || null,
        };

        if (newVideoData) {
            dataToUpdate.videoUrl = newVideoData.downloadUrl;
            dataToUpdate.filePath = newVideoData.filePath;
        }

        if (newThumbnailData) {
            dataToUpdate.thumbnailUrl = newThumbnailData.downloadUrl;
            dataToUpdate.thumbnailPath = newThumbnailData.filePath;
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
