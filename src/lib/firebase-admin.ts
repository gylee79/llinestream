
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import 'dotenv/config'

/**
 * Initializes the Firebase Admin SDK, ensuring it's a singleton.
 * This function is safe to call from any server-side module.
 *
 * @returns The initialized Firebase Admin App instance.
 * @throws {Error} If initialization fails.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.PROJECT_ID;
  const privateKey = process.env.PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    throw new Error('Firebase Admin SDK configuration environment variables are not set.');
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey,
        clientEmail,
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });

    console.log("Firebase Admin SDK initialized successfully.");
    return getApps()[0];

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
