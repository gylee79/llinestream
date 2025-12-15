'use server';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { getStorage, ref, deleteObject } from 'firebase/storage';
import type { Episode } from '@/lib/types';


let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}
const db = getFirestore(app);
const storage = getStorage(app);

type DeletionResult = {
  success: boolean;
  message: string;
};

/**
 * Deletes a hierarchy item and all its descendants, including related Storage files.
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
  const batch = writeBatch(db);

  const deleteStorageFile = async (videoUrl: string) => {
    if (!videoUrl.includes('firebasestorage.googleapis.com')) return;
    try {
      const fileRef = ref(storage, videoUrl);
      await deleteObject(fileRef);
      console.log(`Storage file deleted: ${videoUrl}`);
    } catch (error: any) {
      // If file doesn't exist, it's not a critical error for deletion process.
      if (error.code === 'storage/object-not-found') {
        console.warn(`Storage file not found, but proceeding with DB deletion: ${videoUrl}`);
      } else {
        // For other errors, we should stop and report.
        throw new Error(`Failed to delete storage file: ${error.message}`);
      }
    }
  };

  const deleteEpisodes = async (courseId: string) => {
    const episodesQuery = collection(db, 'courses', courseId, 'episodes');
    const episodesSnapshot = await getDocs(episodesQuery);
    for (const episodeDoc of episodesSnapshot.docs) {
      const episodeData = episodeDoc.data() as Episode;
      if (episodeData.videoUrl) {
        await deleteStorageFile(episodeData.videoUrl);
      }
      batch.delete(episodeDoc.ref);
    }
  };

  const deleteCourses = async (classificationId: string) => {
     const coursesQuery = query(collection(db, 'courses'), where('classificationId', '==', classificationId));
      const coursesSnapshot = await getDocs(coursesQuery);
      for (const courseDoc of coursesSnapshot.docs) {
        await deleteEpisodes(courseDoc.id);
        batch.delete(courseDoc.ref);
      }
  }

  try {
    if (collectionName === 'fields') {
      const classificationsQuery = query(collection(db, 'classifications'), where('fieldId', '==', id));
      const classificationsSnapshot = await getDocs(classificationsQuery);
      for (const classDoc of classificationsSnapshot.docs) {
        await deleteCourses(classDoc.id);
        batch.delete(classDoc.ref);
      }
      batch.delete(doc(db, 'fields', id));

    } else if (collectionName === 'classifications') {
      await deleteCourses(id);
      batch.delete(doc(db, 'classifications', id));

    } else if (collectionName === 'courses') {
      await deleteEpisodes(id);
      batch.delete(doc(db, 'courses', id));
    
    } else if (collectionName === 'episodes') {
      if (!itemData || !itemData.courseId || !itemData.videoUrl) {
        throw new Error('Episode data (courseId, videoUrl) is required for deletion.');
      }
      const episode = itemData as Episode;
      await deleteStorageFile(episode.videoUrl);
      batch.delete(doc(db, 'courses', episode.courseId, 'episodes', id));
    }

    await batch.commit();
    return { success: true, message: '항목 및 모든 관련 파일이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    console.error('Error during batch deletion:', error);
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
