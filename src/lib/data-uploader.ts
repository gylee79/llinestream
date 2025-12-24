'use server';

import { config } from 'dotenv';
config();

import * as admin from 'firebase-admin';
import { initializeAdminApp } from '@/lib/firebase-admin';
import { fields, classifications, courses, episodes, users, subscriptions, policies } from '@/lib/data';
import { Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { User, Subscription } from './types';
import { revalidatePath } from 'next/cache';

// Helper function to handle potential auth user creation
async function ensureAuthUser(auth: admin.auth.Auth, user: Omit<User, 'id'|'activeSubscriptions'>) {
    try {
        return await auth.getUserByEmail(user.email);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            console.log(`Creating auth user for ${user.email}`);
            // Use a secure placeholder password for mock data
            const placeholderPassword = 'password123';
            return await auth.createUser({
                email: user.email,
                password: placeholderPassword,
                displayName: user.name,
                phoneNumber: user.phone,
            });
        }
        throw error;
    }
}


export async function uploadMockData() {
  console.log('Starting data upload...');
  
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore(adminApp);
  const auth = admin.auth(adminApp);
  
  try {
    const batch = firestore.batch();

    // 1. Upload Fields
    console.log(`Uploading ${fields.length} fields...`);
    const fieldIds = [];
    for (const field of fields) {
      const docRef = firestore.collection('fields').doc();
      batch.set(docRef, field);
      fieldIds.push(docRef.id);
    }
    
    // 2. Upload Classifications, mapping them to fields
    console.log(`Uploading ${classifications.length} classifications...`);
    const classificationIds = [];
    for (let i = 0; i < classifications.length; i++) {
        const classification = classifications[i];
        const fieldId = fieldIds[i % fieldIds.length]; // Distribute classifications among fields
        const docRef = firestore.collection('classifications').doc();
        batch.set(docRef, { ...classification, fieldId });
        classificationIds.push(docRef.id);
    }
    
    // 3. Upload Courses, mapping them to classifications
    console.log(`Uploading ${courses.length} courses...`);
    const courseIds = [];
    for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        const classificationId = classificationIds[i % classificationIds.length];
        const docRef = firestore.collection('courses').doc();
        batch.set(docRef, { ...course, classificationId });
        courseIds.push(docRef.id);
    }

    // 4. Upload Episodes, mapping them to courses
    console.log(`Uploading ${episodes.length} episodes...`);
    for (let i = 0; i < episodes.length; i++) {
        const episode = episodes[i];
        const courseId = courseIds[i % courseIds.length];
        const docRef = firestore.collection('courses').doc(courseId).collection('episodes').doc();
        batch.set(docRef, { ...episode, courseId });
    }

    // 5. Upload Users and create Auth users
    console.log(`Uploading ${users.length} users...`);
    const userMap = new Map<string, string>(); // email -> uid
    for (const user of users) {
        const authUser = await ensureAuthUser(auth, user);
        userMap.set(user.email, authUser.uid);
        const userRef = firestore.collection('users').doc(authUser.uid);
        batch.set(userRef, {
            ...user,
            createdAt: Timestamp.fromDate(user.createdAt),
            activeSubscriptions: {}, // Initialize empty
        });
    }

    // 6. Upload Subscriptions, linking to created users and classifications
    console.log(`Uploading ${subscriptions.length} subscriptions...`);
    for (const sub of subscriptions) {
        const userEmail = sub.userId.includes('@') ? sub.userId : `${sub.userId}@example.com`; // Normalize email
        const userId = userMap.get(userEmail);

        // Find a valid classificationId from the ones we created
        const classificationId = classificationIds[subscriptions.indexOf(sub) % classificationIds.length];
        
        if (userId && classificationId) {
            const subDocRef = firestore.collection('users').doc(userId).collection('subscriptions').doc();
            batch.set(subDocRef, {
                ...sub,
                userId,
                classificationId,
                purchasedAt: Timestamp.fromDate(sub.purchasedAt),
                expiresAt: Timestamp.fromDate(sub.expiresAt),
            });
            // Update the activeSubscriptions map on the user
            const userRef = firestore.collection('users').doc(userId);
            batch.update(userRef, {
                [`activeSubscriptions.${classificationId}`]: {
                    purchasedAt: Timestamp.fromDate(sub.purchasedAt),
                    expiresAt: Timestamp.fromDate(sub.expiresAt),
                }
            });
        }
    }
    
    // 7. Upload Policies
    console.log(`Uploading ${policies.length} policies...`);
    for (const policy of policies) {
      const docRef = firestore.collection('policies').doc(policy.slug);
      batch.set(docRef, policy);
    }

    await batch.commit();

    console.log('All data uploaded successfully!');
    revalidatePath('/', 'layout');
    return { success: true, message: '모든 목업 데이터가 성공적으로 업로드되었습니다.' };

  } catch (error) {
    console.error('Error uploading mock data:', error);
    if (error instanceof Error) {
        return { success: false, message: `Upload failed: ${error.message}` };
    }
    return { success: false, message: 'An unknown error occurred during upload.' };
  }
}
