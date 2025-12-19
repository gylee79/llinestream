'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode } from '@/lib/types';
import * as admin from 'firebase-admin';
import { WriteBatch } from 'firebase-admin/firestore';

type DeletionResult = {
  success: boolean;
  message: string;
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

    const deleteStorageFile = async (videoUrl: string) => {
      if (!videoUrl || !videoUrl.includes('firebasestorage.googleapis.com')) {
        return;
      }
      try {
        const decodedUrl = decodeURIComponent(videoUrl);
        const path = decodedUrl.substring(decodedUrl.indexOf('/o/') + 3, decodedUrl.indexOf('?alt=media'));
        
        const fileRef = storage.bucket().file(path);
        await fileRef.delete();
      } catch (error: any) {
        if (error.code === 404) { // Not Found
          console.warn(`Storage file not found, but proceeding with DB deletion: ${videoUrl}`);
        } else {
          console.error(`Failed to delete storage file: ${videoUrl}`, error);
          throw new Error(`Storage file deletion failed: ${error.message}`);
        }
      }
    };

    const deleteEpisodes = async (courseId: string, currentBatch: WriteBatch) => {
      const episodesQuery = db.collection('courses').doc(courseId).collection('episodes');
      const episodesSnapshot = await episodesQuery.get();
      for (const episodeDoc of episodesSnapshot.docs) {
        const episodeData = episodeDoc.data() as Episode;
        if (episodeData.videoUrl) {
          await deleteStorageFile(episodeData.videoUrl);
        }
        currentBatch.delete(episodeDoc.ref);
      }
    };

    const deleteCourses = async (classificationId: string, currentBatch: WriteBatch) => {
       const coursesQuery = db.collection('courses').where('classificationId', '==', classificationId);
       const coursesSnapshot = await coursesQuery.get();
       for (const courseDoc of coursesSnapshot.docs) {
         await deleteEpisodes(courseDoc.id, currentBatch);
         currentBatch.delete(courseDoc.ref);
       }
    }

    if (collectionName === 'fields') {
      const classificationsQuery = db.collection('classifications').where('fieldId', '==', id);
      const classificationsSnapshot = await classificationsQuery.get();
      for (const classDoc of classificationsSnapshot.docs) {
        await deleteCourses(classDoc.id, batch);
        batch.delete(classDoc.ref);
      }
      batch.delete(db.collection('fields').doc(id));

    } else if (collectionName === 'classifications') {
      await deleteCourses(id, batch);
      batch.delete(db.collection('classifications').doc(id));

    } else if (collectionName === 'courses') {
      await deleteEpisodes(id, batch);
      batch.delete(db.collection('courses').doc(id));
    
    } else if (collectionName === 'episodes') {
      if (!itemData || !itemData.courseId || !itemData.videoUrl) {
        throw new Error('Episode data (courseId, videoUrl) is required for deletion.');
      }
      const episode = itemData as Episode;
      await deleteStorageFile(episode.videoUrl);
      batch.delete(db.collection('courses').doc(episode.courseId).collection('episodes').doc(id));
    }

    await batch.commit();
    return { success: true, message: '항목 및 모든 관련 파일이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('DeleteHierarchyItem Error:', errorMessage);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
