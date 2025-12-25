'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Field, Classification, Course, Episode } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';

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
    parentItemId?: string; // e.g., courseId for an episode
}

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) {
        console.warn(`[SKIP DELETE] No file path provided.`);
        return;
    }
    try {
        const file = storage.bucket().file(filePath);
        console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
        await file.delete({ ignoreNotFound: true });
        console.log(`[DELETE SUCCESS] File deleted or did not exist: ${filePath}`);
    } catch (error: any) {
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};

const extractPathFromUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    try {
        const urlObject = new URL(url);
        // Firebase Storage URL: https://firebasestorage.googleapis.com/v0/b/<bucket-name>/o/<path%2Fto%2Ffile>?...
        if (urlObject.hostname === 'firebasestorage.googleapis.com') {
            const pathPart = urlObject.pathname.split('/o/')[1];
            return pathPart ? decodeURIComponent(pathPart.split('?')[0]) : undefined;
        }
        // GCS public URL: https://storage.googleapis.com/<bucket-name>/<path/to/file>
        if (urlObject.hostname === 'storage.googleapis.com') {
            // Path starts after the bucket name, which is the 3rd segment (index 2)
            return decodeURIComponent(urlObject.pathname.split('/').slice(2).join('/'));
        }
    } catch (e) {
        console.warn(`Could not parse URL to extract path: ${url}`, e);
    }
    return undefined;
};


export async function updateThumbnail(payload: UpdateThumbnailPayload): Promise<UpdateResult> {
  const { itemType, itemId, base64Image, imageContentType, imageName, parentItemId } = payload;

  if (!itemType || !itemId) {
    return { success: false, message: '필수 항목(itemType, itemId)이 누락되었습니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    
    let docRef: admin.firestore.DocumentReference;
    if (itemType === 'episodes') {
        if (!parentItemId) return { success: false, message: '에피소드 썸네일 수정에는 상위 강좌 ID(parentItemId)가 필요합니다.' };
        docRef = db.collection('courses').doc(parentItemId).collection('episodes').doc(itemId);
    } else {
        docRef = db.collection(itemType).doc(itemId);
    }

    const currentDoc = await docRef.get();
    if (currentDoc.exists) {
        const oldThumbnailUrl = (currentDoc.data() as Field | Classification | Course | Episode)?.thumbnailUrl;
        const oldThumbnailPath = extractPathFromUrl(oldThumbnailUrl);
        if (oldThumbnailPath) {
             await deleteStorageFileByPath(storage, oldThumbnailPath);
        }
    }

    let downloadUrl: string | null = null;

    // If a new image is provided, upload it. Otherwise, we are deleting the thumbnail.
    if (base64Image && imageContentType && imageName) {
        let filePath = '';
        if (itemType === 'episodes') {
             filePath = `courses/${parentItemId}/episodes/${itemId}/thumbnails/${Date.now()}-${imageName}`;
        } else {
            filePath = `${itemType}/${itemId}/thumbnails/${Date.now()}-${imageName}`;
        }
        
        const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
        
        const file = storage.bucket().file(filePath);
        await file.save(fileBuffer, {
          metadata: { contentType: imageContentType },
          public: true, // IMPORTANT: Make the file publicly accessible
        });

        // Ensure we make it public which is required for publicUrl() to work as expected
        await file.makePublic();

        downloadUrl = file.publicUrl();
    }

    const dataToUpdate = {
      thumbnailUrl: downloadUrl || '', // Save new URL or empty string if deleted
    };

    await docRef.update(dataToUpdate);

    revalidatePath('/admin/content');

    return { success: true, message: `썸네일이 성공적으로 ${downloadUrl ? '업데이트' : '삭제'}되었습니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `작업 실패: ${errorMessage}` };
  }
}
