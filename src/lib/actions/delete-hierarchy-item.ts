
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode, Course, Classification, Field } from '@/lib/types';
import * as admin from 'firebase-admin';
import { WriteBatch, Firestore } from 'firebase-admin/firestore';
import { Storage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';

type DeletionResult = {
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
        console.error(`[delete-hierarchy-item] URL parsing failed for: ${url}`, e);
    }
    
    console.warn(`[delete-hierarchy-item] Could not determine storage path from URL: ${url}`);
    return null;
}


/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
  const path = getPathFromUrl(url);
  if (!path) {
    console.warn(`[SKIP DELETE] Skipping deletion for un-parsable or empty URL: "${url}"`);
    return;
  }
  
  console.log(`[ATTEMPT DELETE] Attempting to delete storage file at path: ${path}`);
  try {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
    console.log(`[DELETE SUCCESS] File deleted or did not exist: ${path}`);
  } catch (error: any) {
    // Log the error but do not throw, allowing DB deletion to proceed.
    console.error(`[DELETE FAILED] Failed to delete storage file at path ${path}:`, error.message);
  }
};


const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch) => {
  const episodesSnapshot = await db.collection('courses').doc(courseId).collection('episodes').get();
  if (episodesSnapshot.empty) return;

  console.log(`[DELETE] Found ${episodesSnapshot.size} episodes under course ${courseId} to delete.`);
  for (const episodeDoc of episodesSnapshot.docs) {
    const episodeData = episodeDoc.data() as Episode;
    if (episodeData.videoUrl) await deleteStorageFile(storage, episodeData.videoUrl);
    if (episodeData.thumbnailUrl) await deleteStorageFile(storage, episodeData.thumbnailUrl);
    batch.delete(episodeDoc.ref);
  }
};

const deleteCourses = async (db: Firestore, storage: Storage, classificationId: string, batch: WriteBatch) => {
  const coursesSnapshot = await db.collection('courses').where('classificationId', '==', classificationId).get();
  if (coursesSnapshot.empty) return;

  console.log(`[DELETE] Found ${coursesSnapshot.size} courses under classification ${classificationId} to delete.`);
  for (const courseDoc of coursesSnapshot.docs) {
    const courseData = courseDoc.data() as Course;
    if (courseData.thumbnailUrl) await deleteStorageFile(storage, courseData.thumbnailUrl);
    await deleteEpisodes(db, storage, courseDoc.id, batch);
    batch.delete(courseDoc.ref);
  }
};

const deleteClassifications = async (db: Firestore, storage: Storage, fieldId: string, batch: WriteBatch) => {
  const classificationsSnapshot = await db.collection('classifications').where('fieldId', '==', fieldId).get();
  if (classificationsSnapshot.empty) return;

  console.log(`[DELETE] Found ${classificationsSnapshot.size} classifications under field ${fieldId} to delete.`);
  for (const classDoc of classificationsSnapshot.docs) {
    const classData = classDoc.data() as Classification;
    if (classData.thumbnailUrl) await deleteStorageFile(storage, classData.thumbnailUrl);
    await deleteCourses(db, storage, classDoc.id, batch);
    batch.delete(classDoc.ref);
  }
};

export async function deleteHierarchyItem(
  collectionName: 'fields' | 'classifications' | 'courses' | 'episodes',
  id: string,
): Promise<DeletionResult> {
  if (!id) {
    return { success: false, message: '삭제할 항목의 ID가 제공되지 않았습니다.' };
  }

  try {
    console.log(`[INIT DELETE] Deleting ${collectionName} with id: ${id}`);
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const batch = db.batch();

    if (collectionName === 'fields') {
      const fieldRef = db.collection('fields').doc(id);
      const fieldDoc = await fieldRef.get();
      if(fieldDoc.exists) {
          const fieldData = fieldDoc.data() as Field;
          if (fieldData.thumbnailUrl) await deleteStorageFile(storage, fieldData.thumbnailUrl);
          await deleteClassifications(db, storage, id, batch);
          batch.delete(fieldRef);
      }
    } else if (collectionName === 'classifications') {
      const classRef = db.collection('classifications').doc(id);
      const classDoc = await classRef.get();
      if(classDoc.exists) {
          const classData = classDoc.data() as Classification;
          if (classData.thumbnailUrl) await deleteStorageFile(storage, classData.thumbnailUrl);
          await deleteCourses(db, storage, id, batch);
          batch.delete(classRef);
      }
    } else if (collectionName === 'courses') {
      const courseRef = db.collection('courses').doc(id);
      const courseDoc = await courseRef.get();
      if(courseDoc.exists) {
          const courseData = courseDoc.data() as Course;
          if (courseData.thumbnailUrl) await deleteStorageFile(storage, courseData.thumbnailUrl);
          await deleteEpisodes(db, storage, id, batch);
        batch.delete(courseRef);
      }
    } else if (collectionName === 'episodes') {
        const episodeQuery = await db.collectionGroup('episodes').where(admin.firestore.FieldPath.documentId(), '==', id).limit(1).get();
        if (episodeQuery.empty) {
            console.warn(`[NOT FOUND] Episode with ID ${id} not found in any course.`);
            return { success: true, message: '에피소드를 찾을 수 없지만, 삭제된 것으로 처리합니다.' };
        }
        const episodeDoc = episodeQuery.docs[0];
        const episodeRef = episodeDoc.ref;
        const episode = episodeDoc.data() as Episode;
        if (episode.videoUrl) await deleteStorageFile(storage, episode.videoUrl);
        if (episode.thumbnailUrl) await deleteStorageFile(storage, episode.thumbnailUrl);
        batch.delete(episodeRef);

    } else {
        return { success: false, message: '잘못된 collection 이름이 제공되었습니다.' };
    }

    await batch.commit();
    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '항목 및 모든 하위 데이터가 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('[delete-hierarchy-item] Final Catch Block Error:', errorMessage, error);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
