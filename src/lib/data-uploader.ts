'use server';

import * as admin from 'firebase-admin';
import { initializeAdminApp } from '@/lib/firebase-admin';
import { fields as mockFields, classifications as mockClassifications, courses as mockCourses, episodes as mockEpisodes, users as mockUsers, subscriptions as mockSubscriptions, policies as mockPolicies } from '@/lib/data';

export async function uploadMockData() {
  console.log('Starting data upload...');
  
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore(adminApp);
  
  try {
    // Keep track of new IDs
    const fieldIdMap = new Map<string, string>();
    const classificationIdMap = new Map<string, string>();
    const courseIdMap = new Map<string, string>();
    
    // --- Phase 1: Upload independent or top-level collections ---
    let batch1 = firestore.batch();

    // Upload Users
    console.log(`Uploading ${mockUsers.length} users...`);
    for (const item of mockUsers) {
      const { id: oldId, ...data } = item;
      const docRef = firestore.collection('users').doc(oldId.includes('admin') ? oldId : undefined); // Preserve admin ID if needed
      batch1.set(docRef, data);
    }

    // Upload Policies
    console.log(`Uploading ${mockPolicies.length} policies...`);
    for (const item of mockPolicies) {
      const docRef = firestore.collection('policies').doc(item.slug);
      batch1.set(docRef, item);
    }
    
    await batch1.commit();
    console.log('Phase 1 (Users, Policies) committed.');

    // --- Phase 2: Upload Fields and get new IDs ---
    let batch2 = firestore.batch();
    console.log(`Uploading ${mockFields.length} fields...`);
    for (const item of mockFields) {
      const { id: oldId, ...data } = item;
      const docRef = firestore.collection('fields').doc();
      batch2.set(docRef, data);
      fieldIdMap.set(oldId, docRef.id);
    }
    await batch2.commit();
    console.log('Phase 2 (Fields) committed.');


    // --- Phase 3: Upload Classifications using new Field IDs ---
    let batch3 = firestore.batch();
    console.log(`Uploading ${mockClassifications.length} classifications...`);
    for (const item of mockClassifications) {
      const { id: oldId, fieldId: oldFieldId, ...data } = item;
      const newFieldId = fieldIdMap.get(oldFieldId);
      if (!newFieldId) {
        throw new Error(`Could not find new field ID for old fieldId: ${oldFieldId}`);
      }
      const docRef = firestore.collection('classifications').doc();
      batch3.set(docRef, { ...data, fieldId: newFieldId });
      classificationIdMap.set(oldId, docRef.id);
    }
    await batch3.commit();
    console.log('Phase 3 (Classifications) committed.');

    // --- Phase 4: Upload Courses using new Classification IDs ---
    let batch4 = firestore.batch();
    console.log(`Uploading ${mockCourses.length} courses...`);
    for (const item of mockCourses) {
        const { id: oldId, classificationId: oldClassificationId, ...data } = item;
        const newClassificationId = classificationIdMap.get(oldClassificationId);
        if(!newClassificationId) {
            throw new Error(`Could not find new classification ID for old classificationId: ${oldClassificationId}`);
        }
        const docRef = firestore.collection('courses').doc();
        batch4.set(docRef, { ...data, classificationId: newClassificationId });
        courseIdMap.set(oldId, docRef.id);
    }
    await batch4.commit();
    console.log('Phase 4 (Courses) committed.');

    // --- Phase 5: Upload Episodes using new Course IDs ---
    let batch5 = firestore.batch();
    console.log(`Uploading ${mockEpisodes.length} episodes...`);
    for(const item of mockEpisodes) {
        const { id: oldId, courseId: oldCourseId, ...data } = item;
        const newCourseId = courseIdMap.get(oldCourseId);
        if(!newCourseId) {
            throw new Error(`Could not find new course ID for old courseId: ${oldCourseId}`);
        }
        const docRef = firestore.collection('courses').doc(newCourseId).collection('episodes').doc();
        batch5.set(docRef, { ...data, courseId: newCourseId });
    }
    await batch5.commit();
    console.log('Phase 5 (Episodes) committed.');

    console.log('All data uploaded successfully!');
    return { success: true, message: '모든 목업 데이터가 성공적으로 업로드되었습니다.' };

  } catch (error) {
    console.error('Error uploading mock data:', error);
    if (error instanceof Error) {
        return { success: false, message: `Upload failed: ${error.message}` };
    }
    return { success: false, message: 'An unknown error occurred during upload.' };
  }
}
