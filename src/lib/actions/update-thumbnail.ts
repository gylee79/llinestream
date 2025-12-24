
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
 * Extracts the storage path from a Firebase Storage URL, decoding it correctly.
 * This is the robust, final version to handle all known URL formats.
 * @param url The full gs:// or https:// URL of the file in Firebase Storage.
 * @param storage The Firebase Admin Storage instance, used to get the default bucket name.
 * @returns The decoded file path within the bucket (e.g., "courses/courseId/image.jpg"), or null if parsing fails.
 */
const getPathFromUrl = (url: string, storage: Storage): string | null => {
    if (!url) return null;

    try {
        // Handle gs:// URLs directly
        if (url.startsWith('gs://')) {
            const bucketNameAndPath = url.substring(5);
            const path = bucketNameAndPath.substring(bucketNameAndPath.indexOf('/') + 1);
            return decodeURIComponent(path);
        }

        // Handle https:// URLs
        const urlObject = new URL(url);
        const bucketName = storage.bucket().name;

        // Standard Firebase Storage URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}
        if (urlObject.hostname === 'firebasestorage.googleapis.com') {
            const pathRegex = new RegExp(`/v0/b/${bucketName}/o/(.+)`);
            const match = urlObject.pathname.match(pathRegex);
            if (match && match[1]) {
                const decodedPath = decodeURIComponent(match[1]);
                return decodedPath.split('?')[0]; // Remove query params like alt=media&token=...
            }
        }

        // Alternative/Public GCS URL format: https://storage.googleapis.com/{bucket}/{path}
        if (urlObject.hostname === 'storage.googleapis.com') {
            const pathPrefix = `/${bucketName}/`;
            if (urlObject.pathname.startsWith(pathPrefix)) {
                const decodedPath = decodeURIComponent(urlObject.pathname.substring(pathPrefix.length));
                 return decodedPath.split('?')[0]; // Remove query params
            }
        }
    } catch (e) {
        console.error(`[update-thumbnail] URL parsing failed for: ${url}`, e);
        return null;
    }
    
    console.warn(`[update-thumbnail] Could not determine storage path from URL: ${url}`);
    return null;
};

/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
    const path = getPathFromUrl(url, storage);
    if (!path) {
        console.warn(`[update-thumbnail] Skipping deletion for un-parsable URL: ${url}`);
        return;
    }
    
    try {
        await storage.bucket().file(path).delete({ ignoreNotFound: true });
        console.log(`[update-thumbnail] Successfully deleted old file: ${path}`);
    } catch (error: any) {
        console.error(`[update-thumbnail] Failed to delete old storage file at path ${path}:`, error);
        // Do not throw; log the error and continue with the update.
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

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const docRef = db.collection(collectionName).doc(itemId);
    
    let downloadUrl: string | null = null;
    let oldThumbnailUrl: string | null = null;

    // 1. If a new file is uploaded, handle old file deletion and new file upload.
    if (imageFile && imageFile.size > 0) {
      // Get the current document to find the old thumbnail URL
      const currentDoc = await docRef.get();
      if (currentDoc.exists) {
        oldThumbnailUrl = (currentDoc.data() as Field | Classification | Course)?.thumbnailUrl || null;
      }

      // Upload the new file
      const filePath = `${collectionName}/${itemId}/${Date.now()}-${imageFile.name}`;
      const fileBuffer = Buffer.from(await imageFile.arrayBuffer());
      
      const file = storage.bucket().file(filePath);
      await file.save(fileBuffer, {
        metadata: { contentType: imageFile.type },
        public: true,
      });

      downloadUrl = file.publicUrl();

      // If upload is successful and there was an old URL, delete the old file
      if (oldThumbnailUrl && oldThumbnailUrl !== downloadUrl) {
          await deleteStorageFile(storage, oldThumbnailUrl);
      }
    }

    // 2. Prepare the data to update in Firestore
    const dataToUpdate: { thumbnailHint: string; thumbnailUrl?: string } = {
      thumbnailHint: hint,
    };

    if (downloadUrl) {
      dataToUpdate.thumbnailUrl = downloadUrl;
    } else if (imageFile) {
        // This case should not happen if upload is successful, but as a safeguard.
        return { success: false, message: '파일 업로드 후 URL을 받지 못했습니다.' };
    }


    // 3. Update the Firestore document
    await docRef.update(dataToUpdate);

    // 4. Revalidate the path to show changes on the client
    revalidatePath('/admin/content');

    return { success: true, message: '썸네일이 성공적으로 업데이트되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('Thumbnail Update Error:', errorMessage, error);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
