
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

  // Check for required environment variables.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing required Firebase Admin SDK environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).'
    );
  }
   if (!storageBucket) {
    throw new Error(
      'Missing required Firebase Storage Bucket environment variable (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).'
    );
  }


  try {
    // Initialize the app with explicit credentials.
    const adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        // The private key from environment variables often has escaped newlines.
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      storageBucket: storageBucket,
    });
    
    console.log("Firebase Admin SDK initialized successfully.");
    return adminApp;

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    // Throw a more informative error.
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
