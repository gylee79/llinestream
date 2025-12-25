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
  if (!url) return;

  let filePath = '';

  try {
      // CASE 1: Client SDK 스타일 (firebasestorage.googleapis.com)
      if (url.includes('firebasestorage.googleapis.com')) {
          const pathPart = url.split('/o/')[1]; // "/o/" 뒷부분 추출
          if (pathPart) {
              filePath = decodeURIComponent(pathPart.split('?')[0]);
          }
      } 
      // CASE 2: Admin SDK 스타일 (storage.googleapis.com)
      else if (url.includes('storage.googleapis.com')) {
          // 예: https://storage.googleapis.com/bucket-name/path/to/file.jpg
          // 도메인과 버킷명을 건너뛰고 경로만 추출해야 함
          const parts = url.split('/');
          // parts[0]: "https:", parts[1]: "", parts[2]: "storage.googleapis.com", parts[3]: "bucket-name"
          // parts[4]부터가 진짜 파일 경로
          if (parts.length >= 5) {
              filePath = decodeURIComponent(parts.slice(4).join('/'));
          }
      }

      if (!filePath) {
          console.warn(`[SKIP DELETE] Could not parse file path from URL: "${url}"`);
          return;
      }

      const file = storage.bucket().file(filePath);
      
      console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
      await file.delete({ ignoreNotFound: true });
      console.log(`[DELETE SUCCESS] File deleted: ${filePath}`);

  } catch (error: any) {
      console.error(`[DELETE FAILED] Error deleting file: ${error.message}`);
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
