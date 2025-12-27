
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
        console.error(`[DELETE FAILED] Could not delete storage file at path ${filePath}. Error: ${error.message}`);
    }
};

const getEpisodeDependenciesRecursive = async (db: Firestore, parentId: string, parentType: 'field' | 'classification' | 'course'): Promise<string[]> => {
    let finalDependencies: string[] = [];

    if (parentType === 'field') {
        const classificationsSnap = await db.collection('classifications').where('fieldId', '==', parentId).get();
        for (const classDoc of classificationsSnap.docs) {
            const classification = classDoc.data() as Classification;
            const deps = await getEpisodeDependenciesRecursive(db, classDoc.id, 'classification');
            finalDependencies = finalDependencies.concat(deps.map(dep => `${classification.name} > ${dep}`));
        }
    } else if (parentType === 'classification') {
        const coursesSnap = await db.collection('courses').where('classificationId', '==', parentId).get();
        for (const courseDoc of coursesSnap.docs) {
            const course = courseDoc.data() as Course;
            const deps = await getEpisodeDependenciesRecursive(db, courseDoc.id, 'course');
            finalDependencies = finalDependencies.concat(deps.map(dep => `${course.name} > ${dep}`));
        }
    } else if (parentType === 'course') {
        const episodesSnap = await db.collection('episodes').where('courseId', '==', parentId).get();
        if (!episodesSnap.empty) {
            return episodesSnap.docs.map(doc => (doc.data() as Episode).title);
        }
    }
    return finalDependencies;
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
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        console.warn(`[NOT FOUND] Document with ID ${id} not found in ${collectionName}.`);
        return { success: false, message: '삭제할 항목을 찾을 수 없습니다.' };
    }

    const item = docSnap.data() as Field | Classification | Course | Episode;
    
    let dependencies: string[] = [];

    if (collectionName === 'fields') {
        const fieldItem = item as Field;
        const fieldDeps = await getEpisodeDependenciesRecursive(db, id, 'field');
        dependencies = fieldDeps.map(dep => `${fieldItem.name} > ${dep}`);
    } else if (collectionName === 'classifications') {
        const classItem = item as Classification;
        const classDeps = await getEpisodeDependenciesRecursive(db, id, 'classification');
        dependencies = classDeps.map(dep => `${classItem.name} > ${dep}`);
    } else if (collectionName === 'courses') {
        const courseItem = item as Course;
        const courseDeps = await getEpisodeDependenciesRecursive(db, id, 'course');
        dependencies = courseDeps.map(dep => `${courseItem.name} > ${dep}`);
    }

    if (dependencies.length > 0) {
      return {
        success: false,
        message: '하위 에피소드가 존재하여 삭제할 수 없습니다. 가장 하위의 에피소드를 먼저 삭제해주세요.',
        dependencies,
      };
    }

    // No dependencies, proceed with deletion
    if (collectionName === 'episodes') {
        const episode = item as Episode;
        await deleteStorageFileByPath(storage, episode.filePath);
        await deleteStorageFileByPath(storage, episode.defaultThumbnailPath);
        await deleteStorageFileByPath(storage, episode.customThumbnailPath);
    } else {
        const hierarchyItem = item as Field | Classification | Course;
        await deleteStorageFileByPath(storage, hierarchyItem.thumbnailPath);
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
