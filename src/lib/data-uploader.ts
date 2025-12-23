
'use server';

import * as admin from 'firebase-admin';
import { initializeAdminApp } from '@/lib/firebase-admin';
import { fields as mockFields, classifications as mockClassifications, courses as mockCourses, episodes as mockEpisodes, users as mockUsers, subscriptions as mockSubscriptions, policies as mockPolicies } from '@/lib/data';
import { Timestamp } from 'firebase-admin/firestore';

export async function uploadMockData() {
  console.log('Starting data upload...');
  
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore(adminApp);
  
  try {
    const batch = firestore.batch();

    // Upload Users
    console.log(`Uploading ${mockUsers.length} users...`);
    for (const user of mockUsers) {
      const { id, createdAt, ...data } = user;
      const docRef = firestore.collection('users').doc(id);
      const plainData = { ...data, createdAt: Timestamp.fromDate(createdAt) };
      batch.set(docRef, plainData);
    }

    // Upload Policies
    console.log(`Uploading ${mockPolicies.length} policies...`);
    for (const policy of mockPolicies) {
      const docRef = firestore.collection('policies').doc(policy.slug);
      batch.set(docRef, policy);
    }

    // Upload Fields
    console.log(`Uploading ${mockFields.length} fields...`);
    for (const field of mockFields) {
      const { id, ...data } = field;
      const docRef = firestore.collection('fields').doc(id);
      batch.set(docRef, data);
    }

    // Upload Classifications
    console.log(`Uploading ${mockClassifications.length} classifications...`);
    for (const classification of mockClassifications) {
      const { id, ...data } = classification;
      const docRef = firestore.collection('classifications').doc(id);
      batch.set(docRef, data);
    }

    // Upload Courses
    console.log(`Uploading ${mockCourses.length} courses...`);
    for (const course of mockCourses) {
      const { id, ...data } = course;
      const docRef = firestore.collection('courses').doc(id);
      batch.set(docRef, data);
    }

    // Upload Episodes
    console.log(`Uploading ${mockEpisodes.length} episodes...`);
    for (const episode of mockEpisodes) {
      const { id, courseId, ...data } = episode;
      const docRef = firestore.collection('courses').doc(courseId).collection('episodes').doc(id);
      batch.set(docRef, { ...data, courseId });
    }

    // Upload Subscriptions
    console.log(`Uploading ${mockSubscriptions.length} subscriptions...`);
    for (const sub of mockSubscriptions) {
        const { id, userId, expiresAt, purchasedAt, ...data } = sub;
        const docRef = firestore.collection('users').doc(userId).collection('subscriptions').doc(id);
        const plainData = { 
          ...data,
          userId,
          expiresAt: Timestamp.fromDate(expiresAt),
          purchasedAt: Timestamp.fromDate(purchasedAt)
        };
        batch.set(docRef, plainData);

        // Also update the activeSubscriptions map on the user document
        const userRef = firestore.collection('users').doc(userId);
        batch.set(userRef, {
            activeSubscriptions: {
                [sub.classificationId]: {
                    expiresAt: Timestamp.fromDate(expiresAt),
                    purchasedAt: Timestamp.fromDate(purchasedAt)
                }
            }
        }, { merge: true });
    }

    await batch.commit();

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
