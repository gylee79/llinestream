'use server';

import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';

/**
 * Initializes the Firebase Admin SDK, ensuring it's a singleton.
 * This function is safe to call from any server-side module.
 *
 * It automatically handles different environments:
 * 1. App Hosting / Cloud Functions: Uses application default credentials.
 * 2. Local Development: Uses the `FIREBASE_ADMIN_SDK_CONFIG` environment variable.
 *
 * @returns The initialized Firebase Admin App instance.
 * @throws {Error} If initialization fails because no credentials can be found.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  try {
    // In a managed environment (like App Hosting), GOOGLE_APPLICATION_CREDENTIALS
    // is set automatically. `initializeApp()` with no arguments will use it.
    console.log("Attempting to initialize Firebase Admin with Application Default Credentials.");
    return admin.initializeApp();
  } catch (error: any) {
    console.warn("Automatic initialization failed. Trying fallback method.", error.message);

    // Fallback for local development using the service account from environment variables.
    const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
    if (serviceAccountEnv) {
      try {
        const serviceAccount = JSON.parse(serviceAccountEnv);
        console.log("Initializing Firebase Admin with service account from env var.");
        return admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } catch (parseError: any) {
        console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string.", parseError);
        throw new Error("Firebase Admin SDK initialization failed due to invalid configuration.");
      }
    }

    // If no credentials can be found by any method, throw a clear error.
    throw new Error(
      'Firebase Admin SDK initialization failed. ' +
      'Could not find Application Default Credentials or a valid FIREBASE_ADMIN_SDK_CONFIG. ' +
      'Please ensure your server environment is set up correctly.'
    );
  }
}
