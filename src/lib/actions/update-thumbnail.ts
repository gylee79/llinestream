
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
 * Extracts the storage path from a Firebase Storage URL.
 * This handles both `firebasestorage.googleapis.com` and `storage.googleapis.com` URLs,
 * and correctly decodes URL-encoded characters in the path.
 * @param url The full gs:// or https:// URL of the file in Firebase Storage.
 * @returns The decoded file path within the bucket (e.g., "courses/courseId/image.jpg"), or null if parsing fails.
 */
function getPathFromUrl(url: string): string | null {
    if (!url) return null;

    try {
        const urlObject = new URL(url);
        let path: string | undefined;

        if (urlObject.protocol === 'gs:') {
            // Handle gs://bucket-name/path/to/file format
             path = urlObject.pathname.startsWith('/') ? urlObject.pathname.substring(1) : urlObject.pathname;
        } else if (urlObject.hostname === 'firebasestorage.googleapis.com') {
            // Handle https://firebasestorage.googleapis.com/v0/b/bucket-name/o/path%2Fto%2Ffile?alt=media&token=... format
            const pathName = urlObject.pathname;
            const oMarker = `/o/`;
            const oIndex = pathName.indexOf(oMarker);
            if (oIndex !== -1) {
                path = pathName.substring(oIndex + oMarker.length);
            }
        } else if (urlObject.hostname === 'storage.googleapis.com') {
             // Handle https://storage.googleapis.com/bucket-name/path/to/file format
             const bucketName = admin.storage().bucket().name;
             const bucketPrefix = `/${bucketName}/`;
             if (urlObject.pathname.startsWith(bucketPrefix)) {
                 path = urlObject.pathname.substring(bucketPrefix.length);
             }
        }
        
        if (path) {
            // The path is URL-encoded, so we need to decode it.
            // e.g. fields%2FzKpFXbCbvls2fhaJmXsz%2FGemini... becomes fields/zKpFXbCbvls2fhaJmXsz/Gemini...
            return decodeURIComponent(path.split('?')[0]);
        }

    } catch (e) {
        console.error(`[update-thumbnail] URL parsing failed for: ${url}`, e);
    }
    
    console.warn(`[update-thumbnail] Could not determine storage path from URL: ${url}`);
    return null;
}


/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
    const path = getPathFromUrl(url);
    if (!path) {
        console.warn(`[SKIP DELETE] Skipping deletion for un-parsable or empty URL: "${url}"`);
        return;
    }
    
    try {
        await storage.bucket().file(path).delete({ ignoreNotFound: true });
        console.log(`[DELETE SUCCESS] Successfully deleted old file: ${path}`);
    } catch (error: any) {
        console.error(`[DELETE FAILED] Failed to delete old storage file at path ${path}:`, error.message);
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

  // A new image file is required for an update.
  if (!imageFile || imageFile.size === 0) {
      return { success: false, message: '업데이트를 위해 새로운 이미지 파일을 제공해야 합니다.' };
  }


  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const docRef = db.collection(collectionName).doc(itemId);
    
    let downloadUrl: string | null = null;

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

    downloadUrl = file.publicUrl();
    
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
