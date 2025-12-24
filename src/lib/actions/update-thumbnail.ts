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

const deleteStorageFile = async (storage: Storage, url: string) => {
  if (!url || !url.startsWith('http')) {
    console.warn(`[SKIP DELETE] Invalid or empty URL provided: "${url}"`);
    return;
  }
  try {
    const file = storage.bucket().file(decodeURIComponent(new URL(url).pathname.split('/o/')[1].split('?')[0]));
    await file.delete({ ignoreNotFound: true });
    console.log(`[DELETE SUCCESS] File deleted or did not exist: ${file.name}`);
  } catch (error: any) {
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
    
    const currentDoc = await docRef.get();
    if (currentDoc.exists) {
        const oldThumbnailUrl = (currentDoc.data() as Field | Classification | Course)?.thumbnailUrl;
        if (oldThumbnailUrl) {
            await deleteStorageFile(storage, oldThumbnailUrl);
        }
    }

    const filePath = `${collectionName}/${itemId}/${Date.now()}-${imageName}`;
    const base64EncodedImageString = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const fileBuffer = Buffer.from(base64EncodedImageString, 'base64');
    
    const file = storage.bucket().file(filePath);
    await file.save(fileBuffer, {
      metadata: { contentType: imageContentType },
      public: true,
    });

    const downloadUrl = file.publicUrl();
    
    if (!downloadUrl) {
        throw new Error('파일 업로드 후 URL을 받지 못했습니다.');
    }

    const dataToUpdate = {
      thumbnailHint: hint,
      thumbnailUrl: downloadUrl,
    };

    await docRef.update(dataToUpdate);

    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '썸네일이 성공적으로 업데이트되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
