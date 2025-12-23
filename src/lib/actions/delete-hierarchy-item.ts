
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode, Course, Classification } from '@/lib/types';
import * as admin from 'firebase-admin';
import { WriteBatch, Firestore } from 'firebase-admin/firestore';
import { Storage } from 'firebase-admin/storage';

type DeletionResult = {
  success: boolean;
  message: string;
};

/**
 * Extracts the storage path from a Firebase Storage URL.
 * @param url The full gs:// or https:// URL.
 * @returns The file path within the bucket.
 */
const getPathFromUrl = (url: string): string | null => {
  if (!url) return null;
  try {
    const decodedUrl = decodeURIComponent(url);
    // Matches paths in URLs like:
    // https://storage.googleapis.com/bucket-name/path/to/file.jpg?alt=media&token=...
    // https://firebasestorage.googleapis.com/v0/b/bucket-name/o/path%2Fto%2Ffile.jpg?alt=media...
    const match = decodedUrl.match(/(?:[^\/]+\/o\/|storage.googleapis.com\/[^\/]+\/)(.*?)(?:\?|$)/);
    return match ? match[1] : null;
  } catch (e) {
    console.error(`Could not decode or parse URL: ${url}`, e);
    return null;
  }
};


/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
  const path = getPathFromUrl(url);
  if (!path) {
    console.warn(`Could not determine storage path from URL, skipping deletion: ${url}`);
    return;
  }

  try {
    await storage.bucket().file(path).delete();
    console.log(`Deleted storage file: ${path}`);
  } catch (error: any) {
    if (error.code === 404) {
      console.warn(`Storage file not found, but proceeding with DB deletion: ${path}`);
    } else {
      console.error(`Failed to delete storage file at path ${path}:`, error);
      // We will not throw here to allow DB deletion to proceed, but the error is logged.
    }
  }
};


/**
 * Deletes all episodes within a course, including their storage files.
 * @param db Firestore instance.
 * @param storage Storage instance.
 * @param courseId The ID of the course whose episodes are to be deleted.
 * @param batch The Firestore write batch.
 */
const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch) => {
  const episodesSnapshot = await db.collection(`courses/${courseId}/episodes`).get();
  if (episodesSnapshot.empty) return;

  for (const episodeDoc of episodesSnapshot.docs) {
    const episodeData = episodeDoc.data() as Episode;
    if (episodeData.videoUrl) {
      await deleteStorageFile(storage, episodeData.videoUrl);
    }
    if (episodeData.thumbnailUrl) {
      await deleteStorageFile(storage, episodeData.thumbnailUrl);
    }
    batch.delete(episodeDoc.ref);
  }
};

/**
 * Deletes all courses within a classification, including their thumbnails and all descendant episodes.
 * @param db Firestore instance.
 * @param storage Storage instance.
 * @param classificationId The ID of the classification whose courses are to be deleted.
 * @param batch The Firestore write batch.
 */
const deleteCourses = async (db: Firestore, storage: Storage, classificationId: string, batch: WriteBatch) => {
  const coursesSnapshot = await db.collection('courses').where('classificationId', '==', classificationId).get();
  if (coursesSnapshot.empty) return;

  for (const courseDoc of coursesSnapshot.docs) {
    const courseData = courseDoc.data() as Course;
    if (courseData.thumbnailUrl) {
      await deleteStorageFile(storage, courseData.thumbnailUrl);
    }
    await deleteEpisodes(db, storage, courseDoc.id, batch);
    batch.delete(courseDoc.ref);
  }
};

/**
 * Deletes all classifications within a field, including their thumbnails and all descendant courses/episodes.
 * @param db Firestore instance.
 * @param storage Storage instance.
 * @param fieldId The ID of the field whose classifications are to be deleted.
 * @param batch The Firestore write batch.
 */
const deleteClassifications = async (db: Firestore, storage: Storage, fieldId: string, batch: WriteBatch) => {
  const classificationsSnapshot = await db.collection('classifications').where('fieldId', '==', fieldId).get();
  if (classificationsSnapshot.empty) return;

  for (const classDoc of classificationsSnapshot.docs) {
    const classData = classDoc.data() as Classification;
    if (classData.thumbnailUrl) {
      await deleteStorageFile(storage, classData.thumbnailUrl);
    }
    await deleteCourses(db, storage, classDoc.id, batch);
    batch.delete(classDoc.ref);
  }
};


/**
 * Deletes a hierarchy item and all its descendants, including related Storage files,
 * using the Firebase Admin SDK for privileged access.
 * @param collectionName The name of the collection ('fields', 'classifications', 'courses', 'episodes').
 * @param id The ID of the document to delete.
 * @param itemData Optional data of the item, required for 'episodes' to delete storage file.
 * @returns A promise that resolves to a DeletionResult.
 */
export async function deleteHierarchyItem(
  collectionName: 'fields' | 'classifications' | 'courses' | 'episodes',
  id: string,
  itemData?: any
): Promise<DeletionResult> {
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const batch = db.batch();

    if (collectionName === 'fields') {
      const fieldRef = db.collection('fields').doc(id);
      const fieldDoc = await fieldRef.get();
      if(fieldDoc.exists) {
          await deleteStorageFile(storage, (fieldDoc.data() as any).thumbnailUrl);
          await deleteClassifications(db, storage, id, batch);
          batch.delete(fieldRef);
      }
    } else if (collectionName === 'classifications') {
      const classRef = db.collection('classifications').doc(id);
      const classDoc = await classRef.get();
      if(classDoc.exists) {
          await deleteStorageFile(storage, (classDoc.data() as any).thumbnailUrl);
          await deleteCourses(db, storage, id, batch);
          batch.delete(classRef);
      }
    } else if (collectionName === 'courses') {
      const courseRef = db.collection('courses').doc(id);
      const courseDoc = await courseRef.get();
      if(courseDoc.exists) {
          await deleteStorageFile(storage, (courseDoc.data() as any).thumbnailUrl);
          await deleteEpisodes(db, storage, id, batch);
          batch.delete(courseRef);
      }
    } else if (collectionName === 'episodes') {
      if (!itemData || !itemData.courseId) {
        throw new Error('Episode data (courseId) is required for deletion.');
      }
      const episodeRef = db.doc(`courses/${itemData.courseId}/episodes/${id}`);
      const episodeDoc = await episodeRef.get();
      if(episodeDoc.exists){
        const episode = episodeDoc.data() as Episode;
        await deleteStorageFile(storage, episode.videoUrl);
        await deleteStorageFile(storage, episode.thumbnailUrl);
        batch.delete(episodeRef);
      }
    } else {
        return { success: false, message: 'Invalid collection name provided.' };
    }

    await batch.commit();
    return { success: true, message: '항목 및 모든 하위 데이터가 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('DeleteHierarchyItem Error:', errorMessage, error);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
