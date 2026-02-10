'use server';

import 'server-only';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { Course } from '@/lib/types';
import { getPublicUrl, extractPathFromUrl } from '@/lib/utils';
import { Storage } from 'firebase-admin/storage';
import { firebaseConfig } from '@/firebase/config';

type UpdateResult = {
  success: boolean;
  message: string;
};

type UpdateCoursePayload = {
    courseId: string;
    name: string;
    description: string;
    existingIntroImageUrls: string[];
    newIntroFiles: File[];
}

const deleteStorageFileByPath = async (storage: Storage, filePath: string | undefined) => {
    if (!filePath) return;
    try {
        const file = storage.bucket().file(filePath);
        if ((await file.exists())[0]) {
            await file.delete();
        }
    } catch (error) {
        console.error(`Failed to delete file at ${filePath}:`, error);
    }
};

const processImages = async (
    storage: Storage,
    courseId: string,
    imageType: 'intro',
    existingUrls: string[],
    newFiles: File[],
    currentPaths: string[]
) => {
    const bucketName = firebaseConfig.storageBucket;
    if (!bucketName) {
        throw new Error('Firebase Storage bucket name is not configured in environment variables.');
    }
    const existingPaths = existingUrls.map(url => extractPathFromUrl(url)).filter(Boolean) as string[];
    const pathsToDelete = currentPaths.filter(path => !existingPaths.includes(path));

    for (const path of pathsToDelete) {
        await deleteStorageFileByPath(storage, path);
    }

    const newImageResults = await Promise.all(
        newFiles.map(async (file) => {
            const path = `courses/${courseId}/${imageType}/${Date.now()}-${file.name}`;
            const buffer = Buffer.from(await file.arrayBuffer());
            const storageFile = storage.bucket().file(path);
            await storageFile.save(buffer, { metadata: { contentType: file.type } });
            const downloadUrl = getPublicUrl(bucketName, path);
            return { url: downloadUrl, path };
        })
    );

    const finalUrls = [...existingUrls, ...newImageResults.map(r => r.url)];
    const finalPaths = [...existingPaths, ...newImageResults.map(r => r.path)];
    
    return { finalUrls, finalPaths };
}


export async function updateCourse(payload: UpdateCoursePayload): Promise<UpdateResult> {
  const { courseId, name, description, existingIntroImageUrls, newIntroFiles } = payload;

  if (!courseId) {
    return { success: false, message: '강좌 ID가 필요합니다.' };
  }

  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);

    const courseRef = db.collection('courses').doc(courseId);
    const courseDoc = await courseRef.get();

    if (!courseDoc.exists) {
      return { success: false, message: '강좌를 찾을 수 없습니다.' };
    }
    const currentCourse = courseDoc.data() as Course;

    const introImagesResult = await processImages(storage, courseId, 'intro', existingIntroImageUrls, newIntroFiles, currentCourse.introImagePaths || []);
    
    // Update Firestore
    await courseRef.update({
      name,
      description,
      introImageUrls: introImagesResult.finalUrls,
      introImagePaths: introImagesResult.finalPaths,
    });

    revalidatePath(`/admin/courses/${courseId}`);
    revalidatePath(`/courses/${courseId}`);

    return { success: true, message: '강좌가 성공적으로 업데이트되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('updateCourse Error:', errorMessage, error);
    return { success: false, message: `업데이트 실패: ${errorMessage}` };
  }
}
