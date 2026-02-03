'use server';

import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';
import { firebaseConfig } from '@/firebase/config';

const ADMIN_APP_NAME = 'firebase-admin-app-rsc';

/**
 * Initializes and/or returns the singleton instance of the Firebase Admin SDK for RSC.
 * This function is safe to call from any server-side module and prevents re-initialization.
 * It uses a named app instance to avoid conflicts with default initializations by other libraries.
 * 
 * @returns {Promise<App>} A promise that resolves with the initialized Firebase Admin App instance.
 * @throws {Error} If the required Firebase service account credentials are not set in environment variables.
 */
export async function initializeAdminApp(): Promise<App> {
  // Find the named app if it already exists.
  const existingApp = getApps().find(app => app.name === ADMIN_APP_NAME);
  if (existingApp) {
    return existingApp;
  }

  // Use environment variables for credentials
  const credentials = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  if (!credentials.projectId || !credentials.clientEmail || !credentials.privateKey) {
    throw new Error('Firebase Admin SDK credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are not set in environment variables.');
  }
  
  // Try to initialize the Admin SDK with the retrieved credentials and a unique name.
  try {
    const newApp = admin.initializeApp({
      credential: admin.credential.cert(credentials as admin.ServiceAccount),
      storageBucket: firebaseConfig.storageBucket,
    }, ADMIN_APP_NAME); // <-- Give the app a unique name

    console.log(`Firebase Admin SDK ('${ADMIN_APP_NAME}') initialized successfully.`);
    return newApp;
  } catch (error) {
    console.error(`Error initializing Firebase Admin SDK ('${ADMIN_APP_NAME}'):`, error);
    // If initialization fails, throw an error with a clear message.
    throw new Error('Could not initialize Firebase Admin SDK. Please check your credentials.');
  }
}
