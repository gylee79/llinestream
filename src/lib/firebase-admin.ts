
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import serviceAccount from './service-account.json';

// Make sure the JSON object is correctly typed for admin.credential.cert()
const serviceAccountParams = {
  projectId: serviceAccount.project_id,
  clientEmail: serviceAccount.client_email,
  privateKey: serviceAccount.private_key,
}

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

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountParams),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });

    console.log("Firebase Admin SDK initialized successfully.");
    return getApps()[0];

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
