
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Field, Classification, Course } from '@/lib/types';
import { Storage } from 'firebase-admin/storage';

type UpdateResult = {
  success: boolean;
  message: string;
};

/**
 * Deletes a file from Firebase Storage using the official SDK method, ignoring not-found errors.
 * This function is robust and handles various Firebase Storage URL formats.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
  if (!url || !url.startsWith('http')) {
    console.warn(`[SKIP DELETE] Invalid or empty URL: "${url}"`);
    return;
  }

  try {
    // Firebase Admin SDK's robust way to get a file reference from a URL
    const file = storage.bucket().file(decodeURIComponent(new URL(url).pathname.split('/o/')[1].split('?')[0]));
    
    console.log(`[ATTEMPT DELETE] Attempting to delete storage file at path: ${file.name}`);
    await file.delete({ ignoreNotFound: true });
    console.log(`[DELETE SUCCESS] File deleted or did not exist: ${file.name}`);
  } catch (error: any) {
    console.error(`[DELETE FAILED] Failed to delete storage file from URL ${url}:`, error.message);
  }
};


/**
 * Updates the thumbnail for a field, classification or course.
 * Handles file upload to Firebase Storage and updates the Firestore document.
 * @param formData The FormData object containing itemType, itemId, hint, and optionally an image file.
 * @returns A promise that resolves to an UpdateResult.
 */
export async function updateThumbnail(formData: FormData): Promise<UpdateResult> {
  const collectionName = formData.get('itemType') as 'fields' | 'classifications' | 'courses';
  const itemId = formData.get('itemId') as string;
  const hint = formData.get('hint') as string;
  const imageFile = formData.get('image') as File | null;

  if (!collectionName || !itemId) {
    return { success: false, message: '필수 항목(itemType, itemId)이 누락되었습니다.' };
  }

  if (!imageFile || imageFile.size === 0) {
      return { success: false, message: '업데이트를 위해 새로운 이미지 파일을 제공해야 합니다.' };
  }


  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const docRef = db.collection(collectionName).doc(itemId);
    
    // 1. Get the current document to find and delete the old thumbnail URL
    const currentDoc = await docRef.get();
    if (currentDoc.exists) {
        const oldThumbnailUrl = (currentDoc.data() as Field | Classification | Course)?.thumbnailUrl;
        if (oldThumbnailUrl) {
            await deleteStorageFile(storage, oldThumbnailUrl);
        }
    }

    // 2. Upload the new file
    const filePath = `${collectionName}/${itemId}/${Date.now()}-${imageFile.name}`;
    const fileBuffer = Buffer.from(await imageFile.arrayBuffer());
    
    const file = storage.bucket().file(filePath);
    await file.save(fileBuffer, {
      metadata: { contentType: imageFile.type },
      public: true,
    });

    const downloadUrl = file.publicUrl();
    
    if (!downloadUrl) {
        throw new Error('파일 업로드 후 URL을 받지 못했습니다.');
    }

    // 3. Prepare the data to update in Firestore
    const dataToUpdate = {
      thumbnailHint: hint,
      thumbnailUrl: downloadUrl,
    };

    // 4. Update the Firestore document
    await docRef.update(dataToUpdate);

    // 5. Revalidate the path to show changes on the client
    revalidatePath('/admin/content');

    return { success: true, message: '썸네일이 성공적으로 업데이트되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
