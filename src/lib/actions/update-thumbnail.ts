
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

const extractPathFromUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    try {
        const urlObject = new URL(url);
        // Firebase Storage URL: https://firebasestorage.googleapis.com/v0/b/<bucket-name>/o/<path%2Fto%2Ffile>?...
        if (urlObject.hostname === 'firebasestorage.googleapis.com' || urlObject.hostname === 'storage.googleapis.com') {
            const pathPart = urlObject.pathname.split('/o/').pop();
            const decodedPath = pathPart ? decodeURIComponent(pathPart.split('?')[0]) : undefined;
            // The decoded path can sometimes include the bucket name. Let's remove it if present.
            if (decodedPath) {
                const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
                const prefix = `${bucketName}/`;
                if (decodedPath.startsWith(prefix)) {
                    return decodedPath.substring(prefix.length);
                }
            }
            return decodedPath;
        }
    } catch (e) {
        console.warn(`Could not parse URL to extract path: ${url}`, e);
    }
    return undefined;
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
    
    const docRef = db.collection(itemType).doc(itemId);

    // Get current data to find the old file path for deletion
    const currentDoc = await docRef.get();
    if (currentDoc.exists) {
        const currentData = currentDoc.data() as Field | Classification | Course | Episode;
        const oldThumbnailPath = currentData.thumbnailPath || extractPathFromUrl(currentData.thumbnailUrl);
        if (oldThumbnailPath) {
            console.log(`[UPDATE] Deleting old thumbnail file: ${oldThumbnailPath}`);
            await deleteStorageFileByPath(storage, oldThumbnailPath);
        }
    }

    let downloadUrl: string | null = null;
    let newThumbnailPath: string | undefined = undefined;

    // If a new image is provided, upload it. Otherwise, we are deleting the thumbnail.
    if (base64Image && imageContentType && imageName) {
        newThumbnailPath = `${itemType}/${itemId}/thumbnails/${Date.now()}-${imageName}`;
        
        const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
        
        const file = storage.bucket().file(newThumbnailPath);
        await file.save(fileBuffer, {
          metadata: { contentType: imageContentType },
          public: true,
        });

        await file.makePublic();
        downloadUrl = file.publicUrl();
    }

    const dataToUpdate = {
      thumbnailUrl: downloadUrl || '',
      thumbnailPath: newThumbnailPath || '',
    };

    await docRef.update(dataToUpdate);

    revalidatePath('/admin/content', 'layout');

    return { success: true, message: `썸네일이 성공적으로 ${downloadUrl ? '업데이트' : '삭제'}되었습니다.` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `작업 실패: ${errorMessage}` };
  }
}
