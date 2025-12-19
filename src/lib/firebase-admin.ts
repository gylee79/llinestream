
import 'server-only';
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import { config } from 'dotenv';

// Load environment variables from .env file for local development
config();

/**
 * Initializes the Firebase Admin SDK, ensuring it's a singleton.
 * This function is safe to call from any server-side module.
 *
 * It primarily uses the `FIREBASE_ADMIN_SDK_CONFIG` environment variable
 * for explicit credential configuration, which is reliable for both local
 * and deployed environments.
 *
 * @returns The initialized Firebase Admin App instance.
 * @throws {Error} If initialization fails because the required environment variable is missing or invalid.
 */
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;

  if (!serviceAccountEnv) {
    console.error("FATAL: FIREBASE_ADMIN_SDK_CONFIG environment variable is not set.");
    throw new Error(
      'Firebase Admin SDK initialization failed. ' +
      'The FIREBASE_ADMIN_SDK_CONFIG environment variable is missing. ' +
      'Please ensure it is set correctly in your environment.'
    );
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
    return getApps()[0];
  } catch (parseError: any) {
    console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string.", parseError);
    throw new Error("Firebase Admin SDK initialization failed due to invalid configuration in FIREBASE_ADMIN_SDK_CONFIG.");
  }
}
