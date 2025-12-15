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
  collectionGroup,
} from 'firebase/firestore';

// Initialize Firebase Admin App
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}
const db = getFirestore(app);

type DeletionResult = {
  success: boolean;
  message: string;
};

/**
 * Deletes a hierarchy item and all its descendants.
 * @param collectionName The name of the collection ('fields', 'classifications', 'courses').
 * @param id The ID of the document to delete.
 * @returns A promise that resolves to a DeletionResult.
 */
export async function deleteHierarchyItem(
  collectionName: 'fields' | 'classifications' | 'courses',
  id: string
): Promise<DeletionResult> {
  const batch = writeBatch(db);

  try {
    if (collectionName === 'fields') {
      // Field 삭제 시, 하위 Classifications, Courses, Episodes 모두 삭제
      const classificationsQuery = query(collection(db, 'classifications'), where('fieldId', '==', id));
      const classificationsSnapshot = await getDocs(classificationsQuery);
      
      for (const classDoc of classificationsSnapshot.docs) {
        // Course 삭제
        const coursesQuery = query(collection(db, 'courses'), where('classificationId', '==', classDoc.id));
        const coursesSnapshot = await getDocs(coursesQuery);
        for (const courseDoc of coursesSnapshot.docs) {
          // Episode 삭제
          const episodesQuery = collection(db, 'courses', courseDoc.id, 'episodes');
          const episodesSnapshot = await getDocs(episodesQuery);
          episodesSnapshot.forEach(episodeDoc => batch.delete(episodeDoc.ref));
          batch.delete(courseDoc.ref);
        }
        batch.delete(classDoc.ref);
      }
      batch.delete(doc(db, 'fields', id));

    } else if (collectionName === 'classifications') {
      // Classification 삭제 시, 하위 Courses, Episodes 모두 삭제
      const coursesQuery = query(collection(db, 'courses'), where('classificationId', '==', id));
      const coursesSnapshot = await getDocs(coursesQuery);
      
      for (const courseDoc of coursesSnapshot.docs) {
        // Episode 삭제
        const episodesQuery = collection(db, 'courses', courseDoc.id, 'episodes');
        const episodesSnapshot = await getDocs(episodesQuery);
        episodesSnapshot.forEach(episodeDoc => batch.delete(episodeDoc.ref));
        batch.delete(courseDoc.ref);
      }
      batch.delete(doc(db, 'classifications', id));

    } else if (collectionName === 'courses') {
      // Course 삭제 시, 하위 Episodes 모두 삭제
      const episodesQuery = collection(db, 'courses', id, 'episodes');
      const episodesSnapshot = await getDocs(episodesQuery);
      episodesSnapshot.forEach(episodeDoc => batch.delete(episodeDoc.ref));
      batch.delete(doc(db, 'courses', id));
    }

    await batch.commit();
    return { success: true, message: '항목 및 모든 하위 항목이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    console.error('Error during batch deletion:', error);
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
