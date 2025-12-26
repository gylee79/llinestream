
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

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) {
        console.warn(`[SKIP DELETE] No file path provided.`);
        return;
    }
    try {
        const file = storage.bucket().file(filePath);
        const [exists] = await file.exists();
        if (exists) {
            console.log(`[ATTEMPT DELETE] Deleting storage file at path: ${filePath}`);
            await file.delete();
            console.log(`[DELETE SUCCESS] File deleted: ${filePath}`);
        } else {
            console.log(`[SKIP DELETE] File does not exist, skipping deletion: ${filePath}`);
        }
    } catch (error: any) {
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};


const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch) => {
  const episodesSnapshot = await db.collection('episodes').where('courseId', '==', courseId).get();
  if (episodesSnapshot.empty) return;

  console.log(`[DELETE] Found ${episodesSnapshot.size} episodes under course ${courseId} to delete.`);
  for (const episodeDoc of episodesSnapshot.docs) {
    const episodeData = episodeDoc.data() as Episode;
    await deleteStorageFileByPath(storage, episodeData.filePath);
    await deleteStorageFileByPath(storage, episodeData.thumbnailPath);
    batch.delete(episodeDoc.ref);
  }
};

const deleteCourses = async (db: Firestore, storage: Storage, classificationId: string, batch: WriteBatch) => {
  const coursesSnapshot = await db.collection('courses').where('classificationId', '==', classificationId).get();
  if (coursesSnapshot.empty) return;

  console.log(`[DELETE] Found ${coursesSnapshot.size} courses under classification ${classificationId} to delete.`);
  for (const courseDoc of coursesSnapshot.docs) {
    const courseData = courseDoc.data() as Course;
    await deleteStorageFileByPath(storage, courseData.thumbnailPath);
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
    await deleteStorageFileByPath(storage, classData.thumbnailPath);
    await deleteCourses(db, storage, classDoc.id, batch);
    batch.delete(classDoc.ref);
  }
};

// This helper is kept for legacy URL formats but new data should use thumbnailPath
const extractPathFromUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    try {
        const urlObject = new URL(url);
        const hostname = urlObject.hostname;
        
        let path: string | null = null;

        // Handles URLs like: https://firebasestorage.googleapis.com/v0/b/your-bucket.appspot.com/o/path%2Fto%2Ffile.jpg?alt=media&token=...
        if (hostname === 'firebasestorage.googleapis.com') {
            const match = urlObject.pathname.match(/\/o\/(.+)/);
            if (match && match[1]) {
                path = match[1];
            }
        // Handles URLs like: https://storage.googleapis.com/your-bucket.appspot.com/path/to/file.jpg
        } else if (hostname === 'storage.googleapis.com') {
            // Pathname is /your-bucket.appspot.com/path/to/file.jpg
            const pathSegments = urlObject.pathname.split('/').slice(2); // Remove the leading empty string and the bucket name
            if (pathSegments.length > 0) {
              path = pathSegments.join('/');
            }
        }
        
        if (path) {
            // Decode URI component and remove query parameters
            return decodeURIComponent(path.split('?')[0]);
        }

    } catch (e) {
        console.warn(`Could not parse URL to extract path: ${url}`, e);
    }
    return undefined;
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

    const docRef = db.collection(collectionName).doc(id);

    const docSnap = await docRef.get();
    const docData = docSnap.exists ? docSnap.data() : itemData;
    
    if (!docSnap.exists && !itemData) {
      console.warn(`[NOT FOUND] Document with ID ${id} not found in ${collectionName}. Assuming deleted.`);
      return { success: true, message: '항목을 찾을 수 없지만, 삭제된 것으로 처리합니다.' };
    }


    if (collectionName === 'fields') {
      await deleteStorageFileByPath(storage, (docData as Field)?.thumbnailPath);
      await deleteClassifications(db, storage, id, batch);
    } else if (collectionName === 'classifications') {
      await deleteStorageFileByPath(storage, (docData as Classification)?.thumbnailPath);
      await deleteCourses(db, storage, id, batch);
    } else if (collectionName === 'courses') {
      await deleteStorageFileByPath(storage, (docData as Course)?.thumbnailPath);
      await deleteEpisodes(db, storage, id, batch);
    } else if (collectionName === 'episodes') {
      const episode = docData as Episode;
      await deleteStorageFileByPath(storage, episode.filePath); // Main video file
      await deleteStorageFileByPath(storage, episode.thumbnailPath); // Thumbnail file
    } else {
      return { success: false, message: '잘못된 collection 이름이 제공되었습니다.' };
    }

    if (docSnap.exists) {
        batch.delete(docRef);
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
