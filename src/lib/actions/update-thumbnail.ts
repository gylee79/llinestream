'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Field, Classification, Course } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';

type UpdateResult = {
  success: boolean;
  message: string;
};

type UpdateThumbnailPayload = {
    itemType: 'fields' | 'classifications' | 'courses';
    itemId: string;
    hint: string;
    base64Image: string;
    imageContentType: string;
    imageName: string;
}

/**
 * Deletes a file from Firebase Storage using its public URL.
 * It correctly parses the URL to extract the file path for deletion.
 * @param storage - The Firebase Admin Storage instance.
 * @param url - The public HTTPS URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
    // Ignore invalid, empty, or non-Firebase Storage URLs
    if (!url || !url.startsWith('https://firebasestorage.googleapis.com')) {
        console.warn(`[SKIP DELETE] Invalid or non-Firebase Storage URL provided: "${url}"`);
        return;
    }

    try {
        // Extract the file path from the URL.
        // Example URL: https://firebasestorage.googleapis.com/v0/b/your-bucket.appspot.com/o/path%2Fto%2Ffile.jpg?alt=media&token=...
        // We need to extract "path/to/file.jpg"
        const filePathWithQuery = url.split('/o/')[1];
        const filePath = decodeURIComponent(filePathWithQuery.split('?')[0]);
        
        const file = storage.bucket().file(filePath);
        
        console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${file.name}`);
        // Use ignoreNotFound: true to prevent errors if the file is already gone.
        await file.delete({ ignoreNotFound: true });
        console.log(`[DELETE SUCCESS] File deleted or did not exist: ${file.name}`);
    } catch (error: any) {
        // Log the error but don't re-throw, as we don't want to block the entire deletion process
        // just because a file cleanup failed.
        console.error(`[DELETE FAILED] Could not delete storage file from URL ${url}. Error: ${error.message}`);
    }
};

export async function updateThumbnail(payload: UpdateThumbnailPayload): Promise<UpdateResult> {
  const { itemType, itemId, hint, base64Image, imageContentType, imageName } = payload;
  const collectionName = itemType;

  if (!collectionName || !itemId) {
    return { success: false, message: '필수 항목(itemType, itemId)이 누락되었습니다.' };
  }

  if (!base64Image) {
      return { success: false, message: '업데이트를 위해 이미지 데이터가 필요합니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const docRef = db.collection(collectionName).doc(itemId);
    
    // 1. Get the current document to find the old thumbnail URL.
    const currentDoc = await docRef.get();
    if (currentDoc.exists) {
        // 2. If an old URL exists, delete the corresponding file from Storage.
        const oldThumbnailUrl = (currentDoc.data() as Field | Classification | Course)?.thumbnailUrl;
        if (oldThumbnailUrl) {
            await deleteStorageFile(storage, oldThumbnailUrl);
        }
    }

    // 3. Upload the new file to Storage.
    const filePath = `${collectionName}/${itemId}/thumbnails/${Date.now()}-${imageName}`;
    const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
    
    const file = storage.bucket().file(filePath);
    await file.save(fileBuffer, {
      metadata: { contentType: imageContentType },
      public: true, // Make the file publicly accessible
    });

    // 4. Get the public URL of the newly uploaded file.
    const downloadUrl = file.publicUrl();
    
    if (!downloadUrl) {
        throw new Error('파일 업로드 후 URL을 받지 못했습니다.');
    }

    // 5. Update the Firestore document with the new URL and hint.
    const dataToUpdate = {
      thumbnailHint: hint,
      thumbnailUrl: downloadUrl,
    };

    await docRef.update(dataToUpdate);

    // Revalidate the path to ensure client-side caches are updated.
    revalidatePath('/admin/content');

    return { success: true, message: '썸네일이 성공적으로 업데이트되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
