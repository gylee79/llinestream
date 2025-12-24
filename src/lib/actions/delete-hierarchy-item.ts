'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Episode, Course, Classification, Field } from '@/lib/types';
import * as admin from 'firebase-admin';
import { WriteBatch, Firestore } from 'firebase-admin/firestore';
import { Storage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';

export type ProgressCallback = (message: string) => void;

type DeletionResult = {
  success: boolean;
  message: string;
};

const noOpProgress: ProgressCallback = () => {};

/**
 * Extracts the storage path from a Firebase Storage URL.
 * Handles both gs:// and various https:// formats robustly.
 * @param url The full gs:// or https:// URL.
 * @returns The file path within the bucket.
 */
const getPathFromUrl = (url: string): string | null => {
  if (!url) return null;
  try {
    const decodedUrl = decodeURIComponent(url);
    
    if (decodedUrl.startsWith('gs://')) {
      const path = decodedUrl.substring(decodedUrl.indexOf('/', 5) + 1);
      return path;
    }
    
    const firebaseStorageMatch = decodedUrl.match(/firebasestorage\.googleapis\.com\/v\d+\/b\/[^/]+\/o\/(.*?)(?:\?|$)/);
    if (firebaseStorageMatch && firebaseStorageMatch[1]) {
      return firebaseStorageMatch[1];
    }

    const googleStorageMatch = decodedUrl.match(/storage\.googleapis\.com\/[^/]+\/(.*)/);
    if (googleStorageMatch && googleStorageMatch[1]) {
        return googleStorageMatch[1];
    }

  } catch (e) {
    console.error(`[delete-hierarchy-item] Could not decode or parse URL: ${url}`, e);
  }
  console.warn(`[delete-hierarchy-item] Could not determine storage path from URL, skipping deletion for: ${url}`);
  return null;
};


/**
 * Deletes a file from Firebase Storage, ignoring not-found errors.
 * @param storage The Firebase Admin Storage instance.
 * @param url The full URL of the file to delete.
 */
const deleteStorageFile = async (storage: Storage, url: string, onProgress: ProgressCallback) => {
  const path = getPathFromUrl(url);
  if (!path) {
    onProgress(`스토리지 파일 경로를 찾을 수 없어 건너뜁니다: ${url.substring(0, 50)}...`);
    return;
  }
  onProgress(`스토리지 파일 삭제 시도: ${path}`);
  try {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
    onProgress(`파일 삭제 완료(또는 존재하지 않음): ${path}`);
  } catch (error: any) {
    console.error(`[delete-hierarchy-item] Failed to delete storage file at path ${path}:`, error);
    onProgress(`파일 삭제 실패: ${path}. 오류: ${error.message}`);
    // We will not throw here to allow DB deletion to proceed, but the error is logged.
  }
};


const deleteEpisodes = async (db: Firestore, storage: Storage, courseId: string, batch: WriteBatch, onProgress: ProgressCallback) => {
  onProgress(`'${courseId}' 강좌의 에피소드 조회 중...`);
  const episodesSnapshot = await db.collection('courses').doc(courseId).collection('episodes').get();
  if (episodesSnapshot.empty) {
    onProgress('삭제할 에피소드가 없습니다.');
    return;
  }
  onProgress(`${episodesSnapshot.size}개의 에피소드를 삭제합니다.`);

  for (const episodeDoc of episodesSnapshot.docs) {
    const episodeData = episodeDoc.data() as Episode;
    onProgress(`'${episodeData.title}' 에피소드 데이터 처리 중...`);
    if (episodeData.videoUrl) await deleteStorageFile(storage, episodeData.videoUrl, onProgress);
    if (episodeData.thumbnailUrl) await deleteStorageFile(storage, episodeData.thumbnailUrl, onProgress);
    batch.delete(episodeDoc.ref);
  }
};

const deleteCourses = async (db: Firestore, storage: Storage, classificationId: string, batch: WriteBatch, onProgress: ProgressCallback) => {
  onProgress(`'${classificationId}' 분류의 강좌 조회 중...`);
  const coursesSnapshot = await db.collection('courses').where('classificationId', '==', classificationId).get();
  if (coursesSnapshot.empty) {
     onProgress('삭제할 강좌가 없습니다.');
     return;
  }
  onProgress(`${coursesSnapshot.size}개의 강좌를 삭제합니다.`);

  for (const courseDoc of coursesSnapshot.docs) {
    const courseData = courseDoc.data() as Course;
    onProgress(`'${courseData.name}' 강좌 데이터 처리 중...`);
    if (courseData.thumbnailUrl) await deleteStorageFile(storage, courseData.thumbnailUrl, onProgress);
    await deleteEpisodes(db, storage, courseDoc.id, batch, onProgress);
    batch.delete(courseDoc.ref);
  }
};

const deleteClassifications = async (db: Firestore, storage: Storage, fieldId: string, batch: WriteBatch, onProgress: ProgressCallback) => {
  onProgress(`'${fieldId}' 분야의 큰분류 조회 중...`);
  const classificationsSnapshot = await db.collection('classifications').where('fieldId', '==', fieldId).get();
  if (classificationsSnapshot.empty) {
    onProgress('삭제할 큰분류가 없습니다.');
    return;
  }
  onProgress(`${classificationsSnapshot.size}개의 큰분류를 삭제합니다.`);

  for (const classDoc of classificationsSnapshot.docs) {
    const classData = classDoc.data() as Classification;
    onProgress(`'${classData.name}' 큰분류 데이터 처리 중...`);
    if (classData.thumbnailUrl) await deleteStorageFile(storage, classData.thumbnailUrl, onProgress);
    await deleteCourses(db, storage, classDoc.id, batch, onProgress);
    batch.delete(classDoc.ref);
  }
};

export async function deleteHierarchyItem(
  collectionName: 'fields' | 'classifications' | 'courses' | 'episodes',
  id: string,
  itemData?: any,
  onProgress: ProgressCallback = noOpProgress,
): Promise<DeletionResult> {
  if (!id) {
    return { success: false, message: '삭제할 항목의 ID가 제공되지 않았습니다.' };
  }

  try {
    onProgress('서버에 연결하고 Admin SDK를 초기화합니다...');
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const batch = db.batch();

    onProgress('삭제할 항목의 종류를 확인합니다...');
    if (collectionName === 'fields') {
      const fieldRef = db.collection('fields').doc(id);
      const fieldDoc = await fieldRef.get();
      if(fieldDoc.exists) {
          const fieldData = fieldDoc.data() as Field;
          onProgress(`'${fieldData.name}' 분야 삭제를 시작합니다.`);
          if (fieldData.thumbnailUrl) await deleteStorageFile(storage, fieldData.thumbnailUrl, onProgress);
          await deleteClassifications(db, storage, id, batch, onProgress);
          batch.delete(fieldRef);
      }
    } else if (collectionName === 'classifications') {
      const classRef = db.collection('classifications').doc(id);
      const classDoc = await classRef.get();
      if(classDoc.exists) {
          const classData = classDoc.data() as Classification;
          onProgress(`'${classData.name}' 큰분류 삭제를 시작합니다.`);
          if (classData.thumbnailUrl) await deleteStorageFile(storage, classData.thumbnailUrl, onProgress);
          await deleteCourses(db, storage, id, batch, onProgress);
          batch.delete(classRef);
      }
    } else if (collectionName === 'courses') {
      const courseRef = db.collection('courses').doc(id);
      const courseDoc = await courseRef.get();
      if(courseDoc.exists) {
          const courseData = courseDoc.data() as Course;
          onProgress(`'${courseData.name}' 상세분류 삭제를 시작합니다.`);
          if (courseData.thumbnailUrl) await deleteStorageFile(storage, courseData.thumbnailUrl, onProgress);
          await deleteEpisodes(db, storage, id, batch, onProgress);
        batch.delete(courseRef);
      }
    } else if (collectionName === 'episodes') {
      if (!itemData || !itemData.courseId) {
        throw new Error('에피소드 삭제를 위해서는 courseId 정보가 필요합니다.');
      }
      onProgress(`'${itemData.title}' 에피소드 삭제를 시작합니다.`);
      const episodeRef = db.collection('courses').doc(itemData.courseId).collection('episodes').doc(id);
      const episodeDoc = await episodeRef.get();
      if(episodeDoc.exists){
        const episode = episodeDoc.data() as Episode;
        if (episode.videoUrl) await deleteStorageFile(storage, episode.videoUrl, onProgress);
        if (episode.thumbnailUrl) await deleteStorageFile(storage, episode.thumbnailUrl, onProgress);
        batch.delete(episodeRef);
      }
    } else {
        return { success: false, message: '잘못된 collection 이름이 제공되었습니다.' };
    }

    onProgress('데이터베이스에 변경사항을 커밋합니다...');
    await batch.commit();
    onProgress('UI를 새로고침합니다...');
    revalidatePath('/admin/content', 'layout');

    return { success: true, message: '항목 및 모든 하위 데이터가 성공적으로 삭제되었습니다.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('[delete-hierarchy-item] 최종 오류:', errorMessage, error);
    onProgress(`오류 발생: ${errorMessage}`);
    return { success: false, message: `삭제 실패: ${errorMessage}` };
  }
}
