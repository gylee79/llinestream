
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Field, Classification, Course, Episode, HeroContent } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';
import { getPublicUrl, extractPathFromUrl } from '@/lib/utils';
import { firebaseConfig } from '@/firebase/config';

type UpdateResult = {
  success: boolean;
  message: string;
};

type UpdateThumbnailPayload = {
    itemType: 'fields' | 'classifications' | 'courses' | 'episodes' | 'settings';
    itemId: string;
    base64Image: string | null; // Allow null for deletion
    imageContentType?: string;
    imageName?: string;
    // For nested or specific field updates
    subCollection?: string; 
    fieldToUpdate?: string; 
    pathFieldToUpdate?: string;
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
  const { itemType, itemId, base64Image, imageContentType, imageName, subCollection, fieldToUpdate, pathFieldToUpdate } = payload;

  if (!itemType || !itemId) {
    return { success: false, message: '필수 항목(itemType, itemId)이 누락되었습니다.' };
  }

  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const bucketName = firebaseConfig.storageBucket;
     if (!bucketName) {
      throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET environment variable is not set.");
    }
    
    const docRef = db.collection(itemType).doc(itemId);

    let downloadUrl: string | null = null;
    let newImagePath: string | undefined = undefined;

    const currentDoc = await docRef.get();
    if (!currentDoc.exists) {
        return { success: false, message: '문서를 찾을 수 없습니다.' };
    }
    const currentData = currentDoc.data() as any;

    let oldImagePath: string | undefined;

    // Determine the old path to delete
    if (itemType === 'settings' && subCollection && fieldToUpdate) {
        const pathField = fieldToUpdate === 'url' ? 'path' : 'pathMobile';
        oldImagePath = currentData?.[subCollection]?.[pathField];
    } else if (itemType === 'episodes') {
        const episodeData = currentData as Episode;
        oldImagePath = episodeData.customThumbnailPath || extractPathFromUrl(episodeData.customThumbnailUrl);
    } else if (fieldToUpdate && pathFieldToUpdate) {
        const oldUrl = subCollection ? currentData?.[subCollection]?.[fieldToUpdate] : currentData?.[fieldToUpdate];
        oldImagePath = currentData?.[pathFieldToUpdate] || extractPathFromUrl(oldUrl);
    } else { // Default thumbnail logic for Field, Classification, Course
        oldImagePath = (currentData as Field | Classification | Course).thumbnailPath || extractPathFromUrl((currentData as Field | Classification | Course).thumbnailUrl);
    }

    if (base64Image && imageContentType && imageName) {
        if (oldImagePath) {
            await deleteStorageFileByPath(storage, oldImagePath);
        }
        
        const pathPrefix = (itemType === 'settings' && subCollection && fieldToUpdate) 
            ? `settings/hero-${subCollection}-${fieldToUpdate.includes('Mobile') ? 'mobile' : 'pc'}`
            : `${itemType}/${itemId}/${fieldToUpdate || 'thumbnails'}`;
            
        const extension = imageName.split('.').pop() || 'jpg';
        const fixedImageName = `background.${extension}`;
        newImagePath = `${pathPrefix}/${fixedImageName}`;
        
        const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
        
        const file = storage.bucket().file(newImagePath);
        await file.save(fileBuffer, { metadata: { contentType: imageContentType } });
        downloadUrl = getPublicUrl(bucketName, newImagePath);

    } else if (base64Image === null) { // Deletion request
        if (oldImagePath) {
            await deleteStorageFileByPath(storage, oldImagePath);
        }
        downloadUrl = '';
        newImagePath = '';
    } else {
        return { success: true, message: '새로운 이미지가 제공되지 않아 스킵합니다.' };
    }

    let dataToUpdate: { [key: string]: any };

    if (itemType === 'settings' && subCollection && fieldToUpdate) { // Hero image case
        const pathField = fieldToUpdate === 'url' ? 'path' : 'pathMobile';
        dataToUpdate = {
            [`${subCollection}.${fieldToUpdate}`]: downloadUrl,
            [`${subCollection}.${pathField}`]: newImagePath
        };
    } else if (fieldToUpdate && pathFieldToUpdate) { // Generic field update (e.g., introImageUrl)
        dataToUpdate = {
            [fieldToUpdate]: downloadUrl,
            [pathFieldToUpdate]: newImagePath,
        };
    } else if (itemType === 'episodes') { // Episode custom thumbnail case
        const episodeData = currentData as Episode;
        dataToUpdate = {
            customThumbnailUrl: downloadUrl,
            customThumbnailPath: newImagePath,
            thumbnailUrl: downloadUrl || episodeData.defaultThumbnailUrl
        }
    } else { // Default thumbnail for Field, Classification, Course
        dataToUpdate = {
          thumbnailUrl: downloadUrl,
          thumbnailPath: newImagePath,
        };
    }
    
    await docRef.update(dataToUpdate);

    revalidatePath('/admin/content', 'layout');
    revalidatePath(`/admin/courses/${itemId}`, 'page');
    revalidatePath('/admin/settings', 'page');
    revalidatePath(`/courses/${itemId}`, 'page');

    return { success: true, message: `이미지가 성공적으로 ${downloadUrl ? '업데이트' : '삭제'}되었습니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Image Update Error:', errorMessage, error);
    return { success: false, message: `작업 실패: ${errorMessage}` };
  }
}
