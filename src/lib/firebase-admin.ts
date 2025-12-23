
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';

// This function is safe to call from any server-side module.
// It ensures that the Firebase Admin SDK is initialized only once.
export function initializeAdminApp(): App {
  // If the app is already initialized, return the existing instance.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // If not initialized, create a new instance.
  try {
    const adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
    
    console.log("Firebase Admin SDK initialized successfully.");
    return adminApp;

  } catch (error: any) {
    console.error("Firebase Admin SDK initialization failed:", error);
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}
