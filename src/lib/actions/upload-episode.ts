
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Episode, Timestamp, EncryptionInfo, PipelineStatus, AiStatus } from '@/lib/types';
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
    duration: number;
    filePath: string; // This is now storage.rawPath
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
    duration: number;
    
    newVideoData?: { downloadUrl: string; filePath: string; fileSize: number; };
    newDefaultThumbnailData?: { downloadUrl: string; filePath: string; };
    newCustomThumbnailData?: { downloadUrl: string | null; filePath: string | null; };

    // Old file URLs for path extraction
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
 * Saves the metadata for a new episode to trigger the backend processing pipeline.
 */
export async function saveEpisodeMetadata(payload: SaveMetadataPayload): Promise<UploadResult> {
    const { 
        episodeId, title, description, isFree, selectedCourseId, instructorId, duration,
        filePath, fileSize, defaultThumbnailUrl, defaultThumbnailPath,
        customThumbnailUrl, customThumbnailPath
    } = payload;

     if (!title || !selectedCourseId || !episodeId || !filePath || !defaultThumbnailUrl || !defaultThumbnailPath || !instructorId) {
        return { success: false, message: '필수 정보(에피소드ID, 제목, 강좌, 강사, 비디오 경로, 대표 썸네일 URL/경로)가 누락되었습니다.' };
    }

    try {
        const adminApp = await initializeAdminApp();
        const db = admin.firestore(adminApp);
        const courseEpisodesQuery = db.collection('episodes').where('courseId', '==', selectedCourseId);
        const courseEpisodesSnap = await courseEpisodesQuery.get();
        const newOrderIndex = courseEpisodesSnap.size;
        
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const newEpisode: Omit<Episode, 'id'> = {
            courseId: selectedCourseId,
            instructorId: instructorId,
            title, description, duration, isFree,
            orderIndex: newOrderIndex,
            createdAt: admin.firestore.FieldValue.serverTimestamp() as Timestamp,
            
            storage: {
                rawPath: filePath,
                encryptedBasePath: `episodes/${episodeId}/segments/`,
                manifestPath: `episodes/${episodeId}/segments/manifest.json`,
                thumbnailBasePath: `episodes/${episodeId}/thumbnails/`,
            },
            
            thumbnails: {
                default: defaultThumbnailUrl,
                defaultPath: defaultThumbnailPath,
                custom: customThumbnailUrl || undefined,
                customPath: customThumbnailPath || undefined,
            },
            thumbnailUrl: customThumbnailUrl || defaultThumbnailUrl,

            status: {
                pipeline: 'queued', // This will trigger the Cloud Function
                step: 'idle',
                playable: false,
                progress: 0,
                jobId: '',
            },
            ai: {
                status: 'idle',
            },
            // This will be populated by the backend function.
            // Explicitly define it to match the type.
            encryption: {} as any,
        };

        await episodeRef.set(newEpisode);
        
        revalidatePath('/admin/content', 'layout');
        return { success: true, message: `에피소드 '${title}'가 등록되었으며, 비디오 처리가 곧 시작됩니다.` };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('saveEpisodeMetadata Error:', errorMessage, error);
        return { success: false, message: `메타데이터 저장 실패: ${errorMessage}` };
    }
}


export async function updateEpisode(payload: UpdateEpisodePayload): Promise<UploadResult> {
    const { 
        episodeId, courseId, instructorId, title, description, isFree, duration,
        newVideoData, newDefaultThumbnailData, newCustomThumbnailData
    } = payload;
    
    if (!episodeId || !courseId || !title || !instructorId) {
        return { success: false, message: '에피소드 ID, 강좌 ID, 강사 ID, 제목은 필수입니다.' };
    }

    try {
        const adminApp = await initializeAdminApp();
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);
        const episodeRef = db.collection('episodes').doc(episodeId);
        
        const currentDoc = await episodeRef.get();
        if (!currentDoc.exists) {
            return { success: false, message: '업데이트할 에피소드를 찾을 수 없습니다.' };
        }
        const currentData = currentDoc.data() as Episode;
        
        // --- Data Update Logic ---
        const dataToUpdate: { [key: string]: any } = {
            title, description, isFree, courseId, instructorId, duration
        };

        // If a new video is uploaded, we need to delete all old processed files and reset the status
        if (newVideoData) {
            console.log(`New video uploaded for ${episodeId}. Deleting old processed files.`);
            // Delete old raw file
            await deleteStorageFileByPath(storage, currentData.storage.rawPath);
            // Delete entire old encrypted segment folder
            const oldEncryptedPrefix = currentData.storage.encryptedBasePath;
            if (oldEncryptedPrefix) {
                await storage.bucket().deleteFiles({ prefix: oldEncryptedPrefix });
            }
            
            dataToUpdate['storage.rawPath'] = newVideoData.filePath;
            // Reset status to trigger re-processing
            dataToUpdate['status.pipeline'] = 'queued';
            dataToUpdate['status.step'] = 'idle';
            dataToUpdate['status.error'] = null;
            dataToUpdate['status.playable'] = false;
            dataToUpdate['ai.status'] = 'idle';
            dataToUpdate['ai.error'] = null;
        }

        // Thumbnail updates
        if (newDefaultThumbnailData) {
            await deleteStorageFileByPath(storage, currentData.thumbnails.defaultPath);
            dataToUpdate['thumbnails.default'] = newDefaultThumbnailData.downloadUrl;
            dataToUpdate['thumbnails.defaultPath'] = newDefaultThumbnailData.filePath;
        }

        if (newCustomThumbnailData) { // This handles both new upload and deletion (null)
            await deleteStorageFileByPath(storage, currentData.thumbnails.customPath);
            dataToUpdate['thumbnails.custom'] = newCustomThumbnailData.downloadUrl ?? undefined;
            dataToUpdate['thumbnails.customPath'] = newCustomThumbnailData.filePath ?? undefined;
        }
        
        // Update the master thumbnailUrl
        const finalCustomUrl = newCustomThumbnailData ? newCustomThumbnailData.downloadUrl : currentData.thumbnails.custom;
        const finalDefaultUrl = newDefaultThumbnailData ? newDefaultThumbnailData.downloadUrl : currentData.thumbnails.default;
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
