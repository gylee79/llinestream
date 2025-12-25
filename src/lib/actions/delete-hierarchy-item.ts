'use server';

import { config } from 'dotenv';
config();

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

const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch) => {
  const episodesSnapshot = await db.collection('courses').doc(courseId).collection('episodes').get();
  if (episodesSnapshot.empty) return;

  console.log(`[DELETE] Found ${episodesSnapshot.size} episodes under course ${courseId} to delete.`);
  for (const episodeDoc of episodesSnapshot.docs) {
    const episodeData = episodeDoc.data() as Episode;
    // Delete associated video and thumbnail files from Storage
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
    // Delete associated thumbnail file from Storage
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
    // Delete associated thumbnail file from Storage
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
  if (!id || !collectionName) {
    return { success: false, message: '삭제할 항목의 ID와 컬렉션 이름이 제공되지 않았습니다.' };
  }

  try {
    console.log(`[INIT DELETE] Deleting ${collectionName} with id: ${id}`);
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const batch = db.batch();

    let docRef: admin.firestore.DocumentReference;
    let docData: admin.firestore.DocumentData | undefined;

    if (collectionName === 'episodes') {
      if (!itemData?.courseId) {
        return { success: false, message: '에피소드 삭제를 위해서는 courseId가 포함된 itemData가 필요합니다.' };
      }
      docRef = db.collection('courses').doc(itemData.courseId).collection('episodes').doc(id);
      docData = itemData; // Use passed data as it might not be in the DB yet
    } else {
      docRef = db.collection(collectionName).doc(id);
      const docSnap = await docRef.get();
      // If itemData is provided, use it, otherwise use data from snapshot
      docData = itemData || docSnap.data();
    }
    
    if (!docData) {
      console.warn(`[NOT FOUND] Document with ID ${id} not found in ${collectionName}. Assuming deleted.`);
      return { success: true, message: '항목을 찾을 수 없지만, 삭제된 것으로 처리합니다.' };
    }

    if (collectionName === 'fields') {
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      await deleteClassifications(db, storage, id, batch);
      batch.delete(docRef);
    } else if (collectionName === 'classifications') {
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      await deleteCourses(db, storage, id, batch);
      batch.delete(docRef);
    } else if (collectionName === 'courses') {
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      await deleteEpisodes(db, storage, id, batch);
      batch.delete(docRef);
    } else if (collectionName === 'episodes') {
      const episode = docData as Episode;
      if (episode.videoUrl) await deleteStorageFile(storage, episode.videoUrl);
      if (episode.thumbnailUrl) await deleteStorageFile(storage, episode.thumbnailUrl);
      batch.delete(docRef);
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
