
'use server';

import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fields as mockFields, classifications as mockClassifications, courses as mockCourses, episodes as mockEpisodes, users as mockUsers, subscriptions as mockSubscriptions } from '@/lib/data';
import { policies as mockPolicies } from '@/lib/policies';

// Helper function to initialize Firebase Admin SDK
function initializeAdminApp(): App {
  if (getApps().length) {
    return getApps()[0];
  }
  
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (!serviceAccountEnv) {
    throw new Error("FIREBASE_ADMIN_SDK_CONFIG is not set. Server-side features will fail.");
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
     return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
     console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string.", error);
     throw new Error("Firebase Admin SDK initialization failed.");
  }
}


export async function uploadMockData() {
  console.log('Starting data upload...');
  
  const adminApp = initializeAdminApp();
  const firestore = getFirestore(adminApp);
  
  const batch = firestore.batch();

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
      const docRef = firestore.collection('users').doc();
      batch.set(docRef, data);
      userIdMap.set(oldId, docRef.id);
    }

    // Upload Fields
    console.log(`Uploading ${mockFields.length} fields...`);
    for (const item of mockFields) {
      const { id: oldId, ...data } = item;
      const docRef = firestore.collection('fields').doc();
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
      const docRef = firestore.collection('classifications').doc();
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
      const docRef = firestore.collection('courses').doc();
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
      const episodeRef = firestore.collection(`courses/${newCourseId}/episodes`).doc();
      batch.set(episodeRef, { ...data, courseId: newCourseId });
    }
    
    // Upload Policies
    console.log(`Uploading ${mockPolicies.length} policies...`);
    for (const item of mockPolicies) {
      // Policies have meaningful slug-based IDs, so we use the slug as the document ID.
      const docRef = firestore.collection('policies').doc(item.slug);
      batch.set(docRef, item);
    }

    // Commit all structural data first
    await batch.commit();

    // --- Start a new batch for user-related updates that depend on the IDs above ---
    const userBatch = firestore.batch();

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

        const subRef = firestore.collection('users').doc(newUserId).collection('subscriptions').doc(newClassificationId);
        userBatch.set(subRef, { 
            ...data, 
            userId: newUserId, 
            classificationId: newClassificationId 
        });

        // Also update the denormalized activeSubscriptions map on the user document
        const userRef = firestore.collection('users').doc(newUserId);
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
