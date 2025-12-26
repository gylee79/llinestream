
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

const getDependencies = async (db: Firestore, collectionName: string, whereField: string, id: string): Promise<string[]> => {
    const snapshot = await db.collection(collectionName).where(whereField, '==', id).get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => {
        const data = doc.data();
        // Episode uses 'title', others use 'name'
        return data.title || data.name || doc.id;
    });
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
    
    const docRef = db.collection(collectionName).doc(id);

    // Check for dependencies before deleting
    let dependencies: string[] = [];
    let dependencyType = '';

    if (collectionName === 'fields') {
        dependencies = await getDependencies(db, 'classifications', 'fieldId', id);
        dependencyType = '큰분류';
    } else if (collectionName === 'classifications') {
        dependencies = await getDependencies(db, 'courses', 'classificationId', id);
        dependencyType = '상세분류';
    } else if (collectionName === 'courses') {
        dependencies = await getDependencies(db, 'episodes', 'courseId', id);
        dependencyType = '에피소드';
    }

    if (dependencies.length > 0) {
      return {
        success: false,
        message: `삭제 실패: 하위 ${dependencyType}가 존재합니다. 먼저 삭제해주세요.`,
        dependencies,
      };
    }

    // No dependencies, proceed with deletion
    const docSnap = await docRef.get();
    const docData = docSnap.exists ? docSnap.data() : itemData;

    if (!docSnap.exists && !itemData) {
      console.warn(`[NOT FOUND] Document with ID ${id} not found in ${collectionName}. Assuming deleted.`);
      return { success: true, message: '항목을 찾을 수 없지만, 삭제된 것으로 처리합니다.' };
    }

    // Delete associated storage files if any
    if (collectionName === 'episodes') {
        const episode = docData as Episode;
        await deleteStorageFileByPath(storage, episode.filePath);
        await deleteStorageFileByPath(storage, episode.thumbnailPath);
    } else { // For Field, Classification, Course
        const item = docData as Field | Classification | Course;
        await deleteStorageFileByPath(storage, item.thumbnailPath);
    }

    // Delete the document itself
    if (docSnap.exists) {
        await docRef.delete();
    }
    
    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '항목이 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('[delete-hierarchy-item] Final Catch Block Error:', errorMessage, error);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
