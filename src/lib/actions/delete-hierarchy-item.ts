
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
        console.error(`[delete-hierarchy-item] URL parsing failed for: ${url}`, e);
        return null;
    }
    
    console.warn(`[delete-hierarchy-item] Could not determine storage path from URL: ${url}`);
    return null;
};


/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
  const path = getPathFromUrl(url, storage);
  if (!path) {
    console.warn(`Skipping deletion for un-parsable URL: ${url}`);
    return;
  }
  console.log(`Attempting to delete storage file at path: ${path}`);
  try {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
    console.log(`File deleted or did not exist: ${path}`);
  } catch (error: any) {
    console.error(`[delete-hierarchy-item] Failed to delete storage file at path ${path}:`, error);
    // Do not throw; log the error and allow DB deletion to proceed.
  }
};


const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch) => {
  const episodesSnapshot = await db.collection('courses').doc(courseId).collection('episodes').get();
  if (episodesSnapshot.empty) return;

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
  itemData?: any
): Promise<DeletionResult> {
  if (!id) {
    return { success: false, message: '삭제할 항목의 ID가 제공되지 않았습니다.' };
  }

  try {
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
      if (!itemData || !itemData.courseId) {
        throw new Error('에피소드 삭제를 위해서는 courseId 정보가 필요합니다.');
      }
      const episodeRef = db.collection('courses').doc(itemData.courseId).collection('episodes').doc(id);
      const episodeDoc = await episodeRef.get();
      if(episodeDoc.exists){
        const episode = episodeDoc.data() as Episode;
        if (episode.videoUrl) await deleteStorageFile(storage, episode.videoUrl);
        if (episode.thumbnailUrl) await deleteStorageFile(storage, episode.thumbnailUrl);
        batch.delete(episodeRef);
      }
    } else {
        return { success: false, message: '잘못된 collection 이름이 제공되었습니다.' };
    }

    await batch.commit();
    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '항목 및 모든 하위 데이터가 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('[delete-hierarchy-item] 최종 오류:', errorMessage, error);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
