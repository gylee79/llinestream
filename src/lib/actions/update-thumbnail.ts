
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
        const hostname = urlObject.hostname;
        
        let path: string | null = null;

        // Handles URLs like: https://firebasestorage.googleapis.com/v0/b/your-bucket.appspot.com/o/path%2Fto%2Ffile.jpg?alt=media&token=...
        if (hostname === 'firebasestorage.googleapis.com') {
            const match = urlObject.pathname.match(/\/o\/(.+)/);
            if (match && match[1]) {
                path = match[1];
            }
        // Handles URLs like: https://storage.googleapis.com/your-bucket.appspot.com/path/to/file.jpg
        } else if (hostname === 'storage.googleapis.com') {
            // Pathname is /your-bucket.appspot.com/path/to/file.jpg
            const pathSegments = urlObject.pathname.split('/').slice(2); // Remove the leading empty string and the bucket name
            if (pathSegments.length > 0) {
              path = pathSegments.join('/');
            }
        }
        
        if (path) {
            // Decode URI component and remove query parameters
            return decodeURIComponent(path.split('?')[0]);
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

    let downloadUrl: string | null = null;
    let newThumbnailPath: string | undefined = undefined;

    // If a new image is provided, upload it. Otherwise, we are deleting the thumbnail.
    if (base64Image && imageContentType && imageName) {
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
    } else if (base64Image === null) { // Explicit deletion request
        const currentDoc = await docRef.get();
        if (currentDoc.exists) {
            const currentData = currentDoc.data() as Field | Classification | Course | Episode;
            const oldThumbnailPath = currentData.thumbnailPath || extractPathFromUrl(currentData.thumbnailUrl);
            await deleteStorageFileByPath(storage, oldThumbnailPath);
        }
        downloadUrl = ''; // Set to empty string for deletion
        newThumbnailPath = '';
    } else {
        // No new image and not a deletion request, so do nothing.
        return { success: true, message: '새로운 썸네일이 제공되지 않아 스킵합니다.' };
    }

    const dataToUpdate = {
      thumbnailUrl: downloadUrl,
      thumbnailPath: newThumbnailPath,
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
