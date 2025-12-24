
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';

/**
 * Initializes the Firebase Admin SDK, ensuring it's only done once.
 * This function is safe to call from any server-side module.
 * @returns {App} The initialized Firebase Admin App instance.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    console.warn("Firebase Admin SDK is not configured. Some server-side features will not work.");
    // This will likely fail but prevents app from crashing if called.
    // A proper setup is required.
    try {
       const adminApp = admin.initializeApp();
       return adminApp;
    } catch(error) {
        console.error("Dummy Firebase Admin SDK initialization failed:", error);
        throw new Error('Firebase Admin SDK is not configured. Please set up the environment variables.');
    }
  }
  
  // Initialize the Admin SDK with credentials
  const adminApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  });

  return adminApp;
}
