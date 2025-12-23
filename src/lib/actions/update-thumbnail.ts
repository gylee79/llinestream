'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

type UpdateResult = {
  success: boolean;
  message: string;
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

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp).bucket();

    let downloadUrl: string | null = null;

    // 1. If a new image file is provided, upload it to Storage
    if (imageFile) {
      const filePath = `${collectionName}/${itemId}/${imageFile.name}`;
      const fileBuffer = Buffer.from(await imageFile.arrayBuffer());
      
      const file = storage.file(filePath);
      await file.save(fileBuffer, {
        metadata: {
          contentType: imageFile.type,
        },
      });

      // Make the file public and get its URL
      await file.makePublic();
      downloadUrl = file.publicUrl();
    }

    // 2. Prepare the data to update in Firestore
    const dataToUpdate: { thumbnailHint: string; thumbnailUrl?: string } = {
      thumbnailHint: hint,
    };

    if (downloadUrl) {
      dataToUpdate.thumbnailUrl = downloadUrl;
    }

    // 3. Update the Firestore document
    const docRef = db.collection(collectionName).doc(itemId);
    await docRef.update(dataToUpdate);

    // 4. Revalidate the path to show changes on the client
    revalidatePath('/admin/content');

    return { success: true, message: '썸네일이 성공적으로 업데이트되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
