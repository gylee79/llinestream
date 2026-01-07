
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Episode, Timestamp } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';
import { extractPathFromUrl } from '@/lib/utils';


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
    instructorId: string;
    videoUrl: string;
    filePath: string;
    fileSize: number;
    // Default thumbnail is required for new episodes
    defaultThumbnailUrl: string;
    defaultThumbnailPath: string;
    // Custom thumbnail is optional
    customThumbnailUrl?: string | null;
    customThumbnailPath?: string | null;
}

type UpdateEpisodePayload = {
    episodeId: string;
    courseId: string;
    instructorId: string;
    title: string;
    description: string;
    isFree: boolean;
    
    // New files data
    newVideoData?: { downloadUrl: string; filePath: string; fileSize: number; };
    newDefaultThumbnailData?: { downloadUrl: string; filePath: string; };
    newCustomThumbnailData?: { downloadUrl: string | null; filePath: string | null; }; // null indicates deletion

    // Old file URLs for path extraction
    oldVideoUrl?: string;
    oldDefaultThumbnailUrl?: string;
    oldCustomThumbnailUrl?: string;
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
    }
};


/**
 * Saves the metadata of an already uploaded episode to Firestore.
 */
export async function saveEpisodeMetadata(payload: SaveMetadataPayload): Promise<UploadResult> {
    const { 
        episodeId, title, description, isFree, selectedCourseId, instructorId, 
        videoUrl, filePath, fileSize, defaultThumbnailUrl, defaultThumbnailPath,
        customThumbnailUrl, customThumbnailPath
    } = payload;

     if (!title || !selectedCourseId || !videoUrl || !episodeId || !filePath || !defaultThumbnailUrl || !defaultThumbnailPath || !instructorId) {
        return { success: false, message: '필수 정보(에피소드ID, 제목, 강좌, 강사, 비디오 URL/경로, 대표 썸네일 URL/경로)가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        
        // This is a placeholder, a more accurate duration could be extracted on the client.
        const duration = Math.floor(Math.random() * (3600 - 60 + 1)) + 60;
        
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const newEpisode: Omit<Episode, 'id'> = {
            courseId: selectedCourseId,
            instructorId: instructorId || '',
            title: title || '',
            description: description || '',
            duration,
            isFree: isFree || false,
            videoUrl: videoUrl,
            filePath: filePath,
            fileSize: fileSize,
            thumbnailUrl: customThumbnailUrl || defaultThumbnailUrl, // Use custom if available
            defaultThumbnailUrl: defaultThumbnailUrl,
            defaultThumbnailPath: defaultThumbnailPath,
            customThumbnailUrl: customThumbnailUrl || '',
            customThumbnailPath: customThumbnailPath || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp() as Timestamp,
            aiProcessingStatus: 'pending', // Set initial status to 'pending'
            aiProcessingError: null,
            aiGeneratedContent: null,
            transcript: null,
        };

        await episodeRef.set(newEpisode);

        // Firestore Trigger in Cloud Functions will now handle the AI processing automatically.
        
        revalidatePath('/admin/content', 'layout');
        return { success: true, message: `에피소드 '${title}'의 정보가 성공적으로 저장되었으며, AI 분석이 백그라운드에서 자동으로 시작됩니다.` };

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
    const { 
        episodeId, courseId, instructorId, title, description, isFree, 
        newVideoData, newDefaultThumbnailData, newCustomThumbnailData,
        oldVideoUrl, oldDefaultThumbnailUrl, oldCustomThumbnailUrl
    } = payload;
    
    if (!episodeId || !courseId || !title || !instructorId) {
        return { success: false, message: '에피소드 ID, 강좌 ID, 강사 ID, 제목은 필수입니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const currentDoc = await episodeRef.get();
        if (!currentDoc.exists) {
            return { success: false, message: '업데이트할 에피소드를 찾을 수 없습니다.' };
        }
        const currentData = currentDoc.data() as Episode;
        
        let shouldResetAIState = false;

        // --- File Deletion Logic ---
        const oldFilePath = extractPathFromUrl(oldVideoUrl);
        if (newVideoData?.filePath && oldFilePath && newVideoData.filePath !== oldFilePath) {
          await deleteStorageFileByPath(storage, oldFilePath);
          // Also delete old VTT file if a new video is uploaded
          if (currentData.vttPath) {
            await deleteStorageFileByPath(storage, currentData.vttPath);
          }
          shouldResetAIState = true;
        }
        
        const oldDefaultThumbnailPath = extractPathFromUrl(oldDefaultThumbnailUrl);
        if (newDefaultThumbnailData?.filePath && oldDefaultThumbnailPath && newDefaultThumbnailData.filePath !== oldDefaultThumbnailPath) {
          await deleteStorageFileByPath(storage, oldDefaultThumbnailPath);
        }

        const oldCustomThumbnailPath = extractPathFromUrl(oldCustomThumbnailUrl);
        if (newCustomThumbnailData && oldCustomThumbnailPath && newCustomThumbnailData.filePath !== oldCustomThumbnailPath) {
           await deleteStorageFileByPath(storage, oldCustomThumbnailPath);
        }

        // --- Data Update Logic ---
        const dataToUpdate: { [key: string]: any } = {
            title,
            description,
            isFree,
            courseId,
            instructorId: instructorId,
        };

        if (newVideoData) {
            dataToUpdate.videoUrl = newVideoData.downloadUrl;
            dataToUpdate.filePath = newVideoData.filePath;
            dataToUpdate.fileSize = newVideoData.fileSize;
        }

        if (shouldResetAIState) {
            // When a new video is uploaded, clear the old transcript and VTT info and set status to pending
            dataToUpdate.transcript = null;
            dataToUpdate.aiGeneratedContent = null;
            dataToUpdate.vttUrl = admin.firestore.FieldValue.delete();
            dataToUpdate.vttPath = admin.firestore.FieldValue.delete();
            dataToUpdate.aiProcessingStatus = 'pending';
            dataToUpdate.aiProcessingError = null;
        }

        if (newDefaultThumbnailData) {
            dataToUpdate.defaultThumbnailUrl = newDefaultThumbnailData.downloadUrl;
            dataToUpdate.defaultThumbnailPath = newDefaultThumbnailData.filePath;
        }
        
        if (newCustomThumbnailData) {
            dataToUpdate.customThumbnailUrl = newCustomThumbnailData.downloadUrl ?? '';
            dataToUpdate.customThumbnailPath = newCustomThumbnailData.filePath ?? '';
        }

        // Recalculate the final thumbnailUrl based on all updates
        const finalCustomUrl = newCustomThumbnailData ? newCustomThumbnailData.downloadUrl : currentData?.customThumbnailUrl;
        const finalDefaultUrl = newDefaultThumbnailData ? newDefaultThumbnailData.downloadUrl : currentData?.defaultThumbnailUrl;
        dataToUpdate.thumbnailUrl = finalCustomUrl || finalDefaultUrl || '';

        await episodeRef.update(dataToUpdate);

        revalidatePath('/admin/content', 'layout');
        return { success: true, message: `에피소드 '${title}' 정보가 업데이트되었습니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('updateEpisode Error:', errorMessage, error);
        return { success: false, message: `에피소드 업데이트 실패: ${errorMessage}` };
    }
}
