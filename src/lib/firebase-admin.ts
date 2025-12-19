
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import serviceAccount from './service-account.json';

/**
 * Initializes the Firebase Admin SDK, ensuring it's a singleton.
 * This function is safe to call from any server-side module.
 * It uses a direct import of the service account JSON file.
 *
 * @returns The initialized Firebase Admin App instance.
 * @throws {Error} If initialization fails.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  try {
    // Initialize the app with the service account credentials.
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });

    console.log("Firebase Admin SDK initialized successfully via imported service account.");
    return getApps()[0];

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    // Throw a more specific error to help debugging.
    if (error.code === 'invalid-credential') {
        throw new Error('Firebase Admin SDK initialization failed due to invalid credentials. Please check your service-account.json file.');
    }
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
