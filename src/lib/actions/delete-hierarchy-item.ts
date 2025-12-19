
'use server';

import 'server-only';
import * as admin from 'firebase-admin';
import { WriteBatch } from 'firebase-admin/firestore';
import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode } from '@/lib/types';

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
  console.log(`Server: deleteHierarchyItem called for collection '${collectionName}' with ID '${id}'.`);

  try {
    console.log("Server: Step 1 - Initializing Firebase Admin app...");
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const batch = db.batch();
    console.log("Server: Step 1 - Firebase Admin initialized successfully.");

    const deleteStorageFile = async (videoUrl: string) => {
      if (!videoUrl || !videoUrl.includes('firebasestorage.googleapis.com')) {
        console.log(`Server: Skipping storage file deletion for non-storage URL: ${videoUrl}`);
        return;
      }
      try {
        const decodedUrl = decodeURIComponent(videoUrl);
        const path = decodedUrl.substring(decodedUrl.indexOf('/o/') + 3, decodedUrl.indexOf('?alt=media'));
        
        console.log(`Server: Attempting to delete storage file at path: ${path}`);
        const fileRef = storage.bucket().file(path);
        await fileRef.delete();
        console.log(`Server: SUCCESS - Storage file deleted: ${path}`);
      } catch (error: any) {
        if (error.code === 404) { // Not Found
          console.warn(`Server: WARNING - Storage file not found, but proceeding with DB deletion: ${videoUrl}`);
        } else {
          console.error(`Server: ERROR - Failed to delete storage file: ${videoUrl}`, error);
          throw new Error(`Storage file deletion failed: ${error.message}`);
        }
      }
    };

    const deleteEpisodes = async (courseId: string, currentBatch: WriteBatch) => {
      console.log(`Server: Querying for episodes under course ID: ${courseId}`);
      const episodesQuery = db.collection('courses').doc(courseId).collection('episodes');
      const episodesSnapshot = await episodesQuery.get();
      console.log(`Server: Found ${episodesSnapshot.docs.length} episodes to delete.`);
      for (const episodeDoc of episodesSnapshot.docs) {
        const episodeData = episodeDoc.data() as Episode;
        if (episodeData.videoUrl) {
          await deleteStorageFile(episodeData.videoUrl);
        }
        console.log(`Server: Adding episode ${episodeDoc.id} to delete batch.`);
        currentBatch.delete(episodeDoc.ref);
      }
    };

    const deleteCourses = async (classificationId: string, currentBatch: WriteBatch) => {
       console.log(`Server: Querying for courses under classification ID: ${classificationId}`);
       const coursesQuery = db.collection('courses').where('classificationId', '==', classificationId);
       const coursesSnapshot = await coursesQuery.get();
       console.log(`Server: Found ${coursesSnapshot.docs.length} courses to delete.`);
       for (const courseDoc of coursesSnapshot.docs) {
         await deleteEpisodes(courseDoc.id, currentBatch);
         console.log(`Server: Adding course ${courseDoc.id} to delete batch.`);
         currentBatch.delete(courseDoc.ref);
       }
    }

    console.log("Server: Step 2 - Determining deletion strategy based on collection name.");
    if (collectionName === 'fields') {
      console.log(`Server: Deleting field '${id}' and its descendants.`);
      const classificationsQuery = db.collection('classifications').where('fieldId', '==', id);
      const classificationsSnapshot = await classificationsQuery.get();
      console.log(`Server: Found ${classificationsSnapshot.docs.length} classifications to delete.`);
      for (const classDoc of classificationsSnapshot.docs) {
        await deleteCourses(classDoc.id, batch);
        console.log(`Server: Adding classification ${classDoc.id} to delete batch.`);
        batch.delete(classDoc.ref);
      }
      console.log(`Server: Adding field ${id} to delete batch.`);
      batch.delete(db.collection('fields').doc(id));

    } else if (collectionName === 'classifications') {
      console.log(`Server: Deleting classification '${id}' and its descendants.`);
      await deleteCourses(id, batch);
      console.log(`Server: Adding classification ${id} to delete batch.`);
      batch.delete(db.collection('classifications').doc(id));

    } else if (collectionName === 'courses') {
      console.log(`Server: Deleting course '${id}' and its descendants.`);
      await deleteEpisodes(id, batch);
      console.log(`Server: Adding course ${id} to delete batch.`);
      batch.delete(db.collection('courses').doc(id));
    
    } else if (collectionName === 'episodes') {
      console.log(`Server: Deleting single episode '${id}'.`);
      if (!itemData || !itemData.courseId || !itemData.videoUrl) {
        throw new Error('Episode data (courseId, videoUrl) is required for deletion.');
      }
      const episode = itemData as Episode;
      await deleteStorageFile(episode.videoUrl);
      console.log(`Server: Adding episode ${id} to delete batch.`);
      batch.delete(db.collection('courses').doc(episode.courseId).collection('episodes').doc(id));
    }

    console.log("Server: Step 3 - Committing delete batch to Firestore.");
    await batch.commit();
    console.log("Server: Step 3 - Batch commit successful.");
    return { success: true, message: '항목 및 모든 관련 파일이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    console.error('Server: FATAL - Error during batch deletion:', error);
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
