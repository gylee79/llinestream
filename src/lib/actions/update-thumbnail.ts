
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';
import { getPublicUrl, extractPathFromUrl } from '@/lib/utils';

type UpdateResult = {
  success: boolean;
  message: string;
};

type UpdateThumbnailPayload = {
    itemType: 'fields' | 'classifications' | 'courses' | 'episodes';
    itemId: string;
    base64Image: string | null; // Allow null for deletion
    imageContentType?: string;
    imageName?: string;
}

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) {
        console.warn(`[SKIP DELETE] No file path provided for deletion.`);
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

export async function updateThumbnail(payload: UpdateThumbnailPayload): Promise<UpdateResult> {
  const { itemType, itemId, base64Image, imageContentType, imageName } = payload;

  if (!itemType || !itemId) {
    return { success: false, message: '필수 항목(itemType, itemId)이 누락되었습니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const bucketName = storage.bucket().name;
    
    const docRef = db.collection(itemType).doc(itemId);

    let downloadUrl: string | null = null;
    let newThumbnailPath: string | undefined = undefined;

    const currentDoc = await docRef.get();
    if (!currentDoc.exists) {
        return { success: false, message: '문서를 찾을 수 없습니다.' };
    }
    const currentData = currentDoc.data() as Field | Classification | Course | Episode;

    // Determine which thumbnail path to use (custom or default)
    const oldThumbnailPath = itemType === 'episodes'
        ? ((currentData as Episode).customThumbnailPath || extractPathFromUrl((currentData as Episode).customThumbnailUrl))
        : (currentData.thumbnailPath || extractPathFromUrl(currentData.thumbnailUrl));


    // If a new image is provided, upload it.
    if (base64Image && imageContentType && imageName) {
        if (oldThumbnailPath) {
            console.log(`[UPDATE] Deleting old thumbnail file: ${oldThumbnailPath}`);
            await deleteStorageFileByPath(storage, oldThumbnailPath);
        }
        
        newThumbnailPath = `${itemType}/${itemId}/thumbnails/${Date.now()}-${imageName}`;
        
        const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
        
        const file = storage.bucket().file(newThumbnailPath);
        await file.save(fileBuffer, {
          metadata: { contentType: imageContentType },
        });

        downloadUrl = getPublicUrl(bucketName, newThumbnailPath);

    } else if (base64Image === null) { // Explicit deletion request for custom thumbnail
        if (oldThumbnailPath) {
            await deleteStorageFileByPath(storage, oldThumbnailPath);
        }
        downloadUrl = ''; // Set to empty string for deletion
        newThumbnailPath = '';
    } else {
        // No new image and not a deletion request, so do nothing.
        return { success: true, message: '새로운 썸네일이 제공되지 않아 스킵합니다.' };
    }

    let dataToUpdate: { [key: string]: any };

    if (itemType === 'episodes') {
        const episodeData = currentData as Episode;
        dataToUpdate = {
            customThumbnailUrl: downloadUrl,
            customThumbnailPath: newThumbnailPath,
            // If we are deleting a custom thumbnail, the main thumbnailUrl should revert to the default.
            thumbnailUrl: downloadUrl || episodeData.defaultThumbnailUrl
        }
    } else {
        dataToUpdate = {
          thumbnailUrl: downloadUrl,
          thumbnailPath: newThumbnailPath,
        };
    }
    
    await docRef.update(dataToUpdate);

    revalidatePath('/admin/content', 'page');

    return { success: true, message: `썸네일이 성공적으로 ${downloadUrl ? '업데이트' : '삭제'}되었습니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `작업 실패: ${errorMessage}` };
  }
}
