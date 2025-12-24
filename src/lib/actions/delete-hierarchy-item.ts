
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
 * Robustly deletes a file from Firebase Storage given its URL.
 * It decodes the URL and handles potential not-found errors gracefully.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full HTTP URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string) => {
  if (!url || !url.startsWith('http')) {
    console.warn(`[SKIP DELETE] Invalid or empty URL: "${url}"`);
    return;
  }

  try {
    // Decode the URL component to handle characters like '%2F' for '/'
    const decodedPath = decodeURIComponent(new URL(url).pathname);
    
    // Extract the file path after the bucket name and '/o/' marker
    const pathParts = decodedPath.split('/o/');
    if (pathParts.length < 2) {
      console.warn(`[SKIP DELETE] Could not determine file path from URL: ${url}`);
      return;
    }
    
    const filePath = pathParts[1].split('?')[0]; // Remove query params like alt=media
    if (!filePath) {
        console.warn(`[SKIP DELETE] Empty file path extracted from URL: ${url}`);
        return;
    }

    const file = storage.bucket().file(filePath);
    
    console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${file.name}`);
    await file.delete({ ignoreNotFound: true });
    console.log(`[DELETE SUCCESS] File deleted or did not exist: ${file.name}`);
  } catch (error: any) {
    console.error(`[DELETE FAILED] Could not delete storage file from URL ${url}. Error: ${error.message}`);
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

    const docRef = db.collection(collectionName).doc(id);
    const docSnap = await docRef.get();
    const docData = docSnap.data();

    if (collectionName === 'fields') {
      await deleteClassifications(db, storage, id, batch);
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      batch.delete(docRef);
    } else if (collectionName === 'classifications') {
      await deleteCourses(db, storage, id, batch);
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      batch.delete(docRef);
    } else if (collectionName === 'courses') {
      await deleteEpisodes(db, storage, id, batch);
      if (docData?.thumbnailUrl) await deleteStorageFile(storage, docData.thumbnailUrl);
      batch.delete(docRef);
    } else if (collectionName === 'episodes') {
        const episodeQuery = await db.collectionGroup('episodes').where(admin.firestore.FieldPath.documentId(), '==', id).limit(1).get();
        if (episodeQuery.empty) {
            console.warn(`[NOT FOUND] Episode with ID ${id} not found in any course.`);
            return { success: true, message: '에피소드를 찾을 수 없지만, 삭제된 것으로 처리합니다.' };
        }
        const episodeDoc = episodeQuery.docs[0];
        const episode = episodeDoc.data() as Episode;
        if (episode.videoUrl) await deleteStorageFile(storage, episode.videoUrl);
        if (episode.thumbnailUrl) await deleteStorageFile(storage, episode.thumbnailUrl);
        batch.delete(episodeDoc.ref);
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
