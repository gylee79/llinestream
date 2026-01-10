
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode, Course, Classification, Field } from '@/lib/types';
import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';
import { Storage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';

type DeletionResult = {
  success: boolean;
  message: string;
  dependencies?: string[];
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
        // Suppress "Not Found" errors during cleanup, as they are not critical.
        if (error.code === 404) {
             console.log(`[SKIP DELETE] File not found during cleanup, which is acceptable: ${filePath}`);
             return;
        }
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};

const deleteChunksSubcollection = async (db: Firestore, episodeId: string): Promise<void> => {
    const chunksRef = db.collection('episodes').doc(episodeId).collection('chunks');
    const snapshot = await chunksRef.get();
    
    if (snapshot.empty) {
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`[DELETE SUCCESS] Deleted chunks subcollection for episode ${episodeId}.`);
};

async function getFieldDependencies(db: Firestore, fieldId: string): Promise<string[]> {
    const classificationsSnap = await db.collection('classifications').where('fieldId', '==', fieldId).get();
    return classificationsSnap.docs.map(doc => (doc.data() as Classification).name);
}

async function getClassificationDependencies(db: Firestore, classificationId: string): Promise<string[]> {
    const coursesSnap = await db.collection('courses').where('classificationId', '==', classificationId).get();
    return coursesSnap.docs.map(doc => (doc.data() as Course).name);
}

async function getCourseDependencies(db: Firestore, courseId: string): Promise<string[]> {
    const episodesSnap = await db.collection('episodes').where('courseId', '==', courseId).get();
    return episodesSnap.docs.map(doc => (doc.data() as Episode).title);
}

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
    
    const docRef = db.collection(collectionName).doc(id);
    // Use passed itemData if available, otherwise fetch from Firestore.
    // This is crucial for episode deletion where paths are needed.
    const docSnap = await docRef.get();
    const item = itemData || docSnap.data();

    if (!docSnap.exists || !item) {
        console.warn(`[NOT FOUND] Document with ID ${id} not found in ${collectionName}. Assuming already deleted.`);
        revalidatePath('/admin/content', 'layout');
        return { success: true, message: '항목을 찾을 수 없어 이미 삭제된 것으로 간주합니다.' };
    }
    
    // Check for dependencies before deleting
    let dependencies: string[] = [];
    if (collectionName === 'fields') {
        dependencies = await getFieldDependencies(db, id);
    } else if (collectionName === 'classifications') {
        dependencies = await getClassificationDependencies(db, id);
    } else if (collectionName === 'courses') {
        dependencies = await getCourseDependencies(db, id);
    }

    if (dependencies.length > 0) {
      return {
        success: false,
        message: '하위 항목이 존재하여 삭제할 수 없습니다. 하위 항목을 먼저 삭제해주세요.',
        dependencies,
      };
    }

    // No dependencies, proceed with deletion
    if (collectionName === 'episodes') {
        const episode = item as Episode;
        await deleteStorageFileByPath(storage, episode.filePath);
        await deleteStorageFileByPath(storage, episode.defaultThumbnailPath);
        await deleteStorageFileByPath(storage, episode.customThumbnailPath);
        if (episode.vttPath) {
          await deleteStorageFileByPath(storage, episode.vttPath);
        }
        await deleteChunksSubcollection(db, id);
    } else if (collectionName === 'courses') {
        const course = item as Course;
        if (course.thumbnailPath) await deleteStorageFileByPath(storage, course.thumbnailPath);
        if (course.introImagePaths) {
            for (const path of course.introImagePaths) {
                await deleteStorageFileByPath(storage, path);
            }
        }
    } else { // Fields and Classifications
        const hierarchyItem = item as Field | Classification;
        if (hierarchyItem.thumbnailPath) {
          await deleteStorageFileByPath(storage, hierarchyItem.thumbnailPath);
        }
    }

    await docRef.delete();
    
    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '항목이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('[delete-hierarchy-item] Final Catch Block Error:', errorMessage, error);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
