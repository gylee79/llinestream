'use server';
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import 'dotenv/config'

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

  const serviceAccountString = process.env.SERVICE_ACCOUNT_JSON;

  if (!serviceAccountString) {
      throw new Error('Firebase service account JSON is not set in SERVICE_ACCOUNT_JSON environment variable.');
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountString);

    // Initialize the app with the service account credentials.
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });

    console.log("Firebase Admin SDK initialized successfully via service account JSON.");
    return getApps()[0];

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    if (error instanceof SyntaxError) {
        throw new Error('Failed to parse SERVICE_ACCOUNT_JSON. Please ensure it is a valid JSON string.');
    }
    if (error.code === 'invalid-credential') {
        throw new Error('Firebase Admin SDK initialization failed due to invalid credentials. Please check your service account JSON.');
    }
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
