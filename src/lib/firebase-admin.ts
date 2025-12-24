
'use server';

import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';

// This is a global variable to hold the initialized Firebase Admin app instance.
// It ensures that we only initialize the app once per server instance.
let adminApp: App | null = null;

/**
 * Initializes and/or returns the singleton instance of the Firebase Admin SDK.
 * This function is safe to call from any server-side module and prevents re-initialization.
 * 
 * @returns {App} The initialized Firebase Admin App instance.
 * @throws {Error} If the required Firebase service account credentials are not set in environment variables.
 */
export function initializeAdminApp(): App {
  // If the app instance already exists, return it to avoid re-initialization.
  if (adminApp) {
    return adminApp;
  }

  // Check if getApps() can find an already initialized app. This is a robust check.
  const existingApps = getApps();
  if (existingApps.length > 0) {
    adminApp = existingApps[0];
    return adminApp;
  }

  // Retrieve credentials from environment variables.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  // Check if all necessary environment variables are set. This is a critical check.
  if (!privateKey || !clientEmail || !projectId || !storageBucket) {
    const errorMessage = 'Firebase Admin SDK is not configured. Missing required environment variables: FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, NEXT_PUBLIC_FIREBASE_PROJECT_ID, or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.';
    console.error(errorMessage);
    // In a production environment, this should throw an error to prevent the app from running in a misconfigured state.
    throw new Error(errorMessage);
  }
  
  // Try to initialize the Admin SDK with the retrieved credentials.
  try {
    const newAdminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: storageBucket,
    });

    console.log('Firebase Admin SDK initialized successfully.');
    adminApp = newAdminApp; // Store the new instance in our global variable.
    return adminApp;
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    // If initialization fails, throw an error with a clear message.
    throw new Error('Could not initialize Firebase Admin SDK. Please check your service account credentials.');
  }
}
