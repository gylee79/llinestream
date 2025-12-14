'use server';

import { writeBatch, collection, doc, getFirestore } from 'firebase/firestore';
import { fields, classifications, courses, episodes, users, subscriptions, policies } from '@/lib/data';
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
    // Upload Users
    console.log(`Uploading ${users.length} users...`);
    users.forEach((item) => {
        const docRef = doc(firestore, 'users', item.id);
        batch.set(docRef, item);
    });

    // Upload Fields
    console.log(`Uploading ${fields.length} fields...`);
    fields.forEach((item) => {
      const docRef = doc(firestore, 'fields', item.id);
      batch.set(docRef, item);
    });

    // Upload Classifications
    console.log(`Uploading ${classifications.length} classifications...`);
    classifications.forEach((item) => {
      const docRef = doc(firestore, 'classifications', item.id);
      batch.set(docRef, item);
    });

    // Upload Courses
    console.log(`Uploading ${courses.length} courses...`);
    courses.forEach((item) => {
      const docRef = doc(firestore, 'courses', item.id);
      batch.set(docRef, item);
    });

    // Upload Episodes
    console.log(`Uploading ${episodes.length} episodes...`);
    episodes.forEach((item) => {
        // The episode ID is now explicitly set in the data
        const episodeRef = doc(firestore, `courses/${item.courseId}/episodes/${item.id}`);
        batch.set(episodeRef, item);
    });

    // Upload Subscriptions as subcollections
    console.log(`Uploading ${subscriptions.length} subscriptions...`);
    subscriptions.forEach((item) => {
      // The subscription ID is the classification ID for easy lookup
      const subRef = doc(collection(firestore, 'users', item.userId, 'subscriptions'), item.id);
      batch.set(subRef, item);
      
      // Also update the denormalized activeSubscriptions map on the user document
      const userRef = doc(firestore, 'users', item.userId);
      batch.update(userRef, {
        [`activeSubscriptions.${item.classificationId}`]: {
            expiresAt: item.expiresAt
        }
      });
    });

    // Upload Policies
    console.log(`Uploading ${policies.length} policies...`);
    policies.forEach((item) => {
        const docRef = doc(firestore, 'policies', item.id);
        batch.set(docRef, item);
    });
    
    await batch.commit();
    console.log('Batch commit successful!');
    return { success: true, message: 'All mock data uploaded successfully.' };

  } catch (error) {
    console.error('Error uploading mock data:', error);
    if (error instanceof Error) {
        return { success: false, message: `Upload failed: ${error.message}` };
    }
    return { success: false, message: 'An unknown error occurred during upload.' };
  }
}
