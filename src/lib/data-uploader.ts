'use server';

import { writeBatch, collection, doc, getFirestore } from 'firebase/firestore';
import { fields as mockFields, classifications as mockClassifications, courses as mockCourses, episodes as mockEpisodes, users as mockUsers, subscriptions as mockSubscriptions, policies as mockPolicies } from '@/lib/data';
import { initializeApp, getApps } from 'firebase/app';
import { firebaseConfig } from '@/firebase/config';

export async function uploadMockData() {
  console.log('Starting data upload...');
  
  let app;
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  const firestore = getFirestore(app);

  const batch = writeBatch(firestore);

  try {
    // Keep track of new IDs
    const fieldIdMap = new Map<string, string>();
    const classificationIdMap = new Map<string, string>();
    const courseIdMap = new Map<string, string>();
    const userIdMap = new Map<string, string>();

    // Upload Users
    console.log(`Uploading ${mockUsers.length} users...`);
    for (const item of mockUsers) {
      const { id: oldId, ...data } = item;
      const docRef = doc(collection(firestore, 'users'));
      batch.set(docRef, data);
      userIdMap.set(oldId, docRef.id);
    }

    // Upload Fields
    console.log(`Uploading ${mockFields.length} fields...`);
    for (const item of mockFields) {
      const { id: oldId, ...data } = item;
      const docRef = doc(collection(firestore, 'fields'));
      batch.set(docRef, data);
      fieldIdMap.set(oldId, docRef.id);
    }

    // Upload Classifications
    console.log(`Uploading ${mockClassifications.length} classifications...`);
    for (const item of mockClassifications) {
      const { id: oldId, fieldId: oldFieldId, ...data } = item;
      const newFieldId = fieldIdMap.get(oldFieldId);
      if (!newFieldId) {
        throw new Error(`Could not find new field ID for old fieldId: ${oldFieldId}`);
      }
      const docRef = doc(collection(firestore, 'classifications'));
      batch.set(docRef, { ...data, fieldId: newFieldId });
      classificationIdMap.set(oldId, docRef.id);
    }

    // Upload Courses
    console.log(`Uploading ${mockCourses.length} courses...`);
    for (const item of mockCourses) {
      const { id: oldId, classificationId: oldClassificationId, ...data } = item;
      const newClassificationId = classificationIdMap.get(oldClassificationId);
      if (!newClassificationId) {
        throw new Error(`Could not find new classification ID for old classificationId: ${oldClassificationId}`);
      }
      const docRef = doc(collection(firestore, 'courses'));
      batch.set(docRef, { ...data, classificationId: newClassificationId });
      courseIdMap.set(oldId, docRef.id);
    }

    // Upload Episodes
    console.log(`Uploading ${mockEpisodes.length} episodes...`);
    for (const item of mockEpisodes) {
      const { id: oldId, courseId: oldCourseId, ...data } = item;
      const newCourseId = courseIdMap.get(oldCourseId);
      if (!newCourseId) {
        throw new Error(`Could not find new course ID for old courseId: ${oldCourseId}`);
      }
      const episodeRef = doc(collection(firestore, `courses/${newCourseId}/episodes`));
      batch.set(episodeRef, { ...data, courseId: newCourseId });
    }
    
    // Upload Policies
    console.log(`Uploading ${mockPolicies.length} policies...`);
    for (const item of mockPolicies) {
      const { id: oldId, ...data } = item;
      // Policies have meaningful slug-based IDs, so we keep them
      const docRef = doc(firestore, 'policies', oldId);
      batch.set(docRef, data);
    }

    // Commit all structural data first
    await batch.commit();

    // --- Start a new batch for user-related updates that depend on the IDs above ---
    const userBatch = writeBatch(firestore);

    // Upload Subscriptions
    console.log(`Uploading ${mockSubscriptions.length} subscriptions...`);
    for (const item of mockSubscriptions) {
        const { userId: oldUserId, classificationId: oldClassificationId, ...data } = item;
        const newUserId = userIdMap.get(oldUserId);
        const newClassificationId = classificationIdMap.get(oldClassificationId);

        if (!newUserId || !newClassificationId) {
            console.warn(`Skipping subscription for old user ID ${oldUserId} or old classification ID ${oldClassificationId} because new ID was not found.`);
            continue;
        }

        const subRef = doc(collection(firestore, 'users', newUserId, 'subscriptions'), newClassificationId);
        userBatch.set(subRef, { 
            ...data, 
            userId: newUserId, 
            classificationId: newClassificationId 
        });

        // Also update the denormalized activeSubscriptions map on the user document
        const userRef = doc(firestore, 'users', newUserId);
        userBatch.update(userRef, {
            [`activeSubscriptions.${newClassificationId}`]: {
                expiresAt: data.expiresAt
            }
        });
    }

    // Commit user-related data
    await userBatch.commit();
    
    console.log('All batch commits successful!');
    return { success: true, message: 'All mock data uploaded successfully with auto-generated IDs.' };

  } catch (error) {
    console.error('Error uploading mock data:', error);
    if (error instanceof Error) {
        return { success: false, message: `Upload failed: ${error.message}` };
    }
    return { success: false, message: 'An unknown error occurred during upload.' };
  }
}
