
'use server';

import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';

/**
 * Initializes the Firebase Admin SDK, ensuring it's only done once (Singleton pattern).
 * This function is safe to call from any server-side module.
 * @returns {App} The initialized Firebase Admin App instance.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  const alreadyInitialized = getApps();
  if (alreadyInitialized.length > 0) {
    return alreadyInitialized[0];
  }

  // Retrieve credentials from environment variables.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  // Check if all necessary environment variables are set.
  if (!privateKey || !clientEmail || !projectId) {
    const errorMessage = 'Firebase Admin SDK is not configured. Missing required environment variables: FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, or FIREBASE_PROJECT_ID.';
    console.error(errorMessage);
    // In a real production scenario, you might want to throw an error 
    // to prevent the application from running with a broken configuration.
    throw new Error(errorMessage);
  }
  
  // Initialize the Admin SDK with credentials
  try {
    const adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
    console.log('Firebase Admin SDK initialized successfully.');
    return adminApp;
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    throw new Error('Could not initialize Firebase Admin SDK. Please check your service account credentials.');
  }
}
