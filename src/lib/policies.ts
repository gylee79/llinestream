
'use server';

import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';
import type { Policy } from './types';

// This function initializes the Firebase Admin SDK.
// It's safe to call multiple times.
function initializeAdminApp(): App {
  // If already initialized, return the existing app.
  if (getApps().length) {
    return getApps()[0];
  }
  
  // App Hosting provides GOOGLE_APPLICATION_CREDENTIALS automatically.
  // When running on App Hosting, admin.initializeApp() will use these
  // credentials to initialize, giving the server admin privileges.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.initializeApp();
  }

  // If App Hosting credentials are not available (e.g., local development),
  // fall back to using the service account from environment variables.
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (serviceAccountEnv) {
      try {
        const serviceAccount = JSON.parse(serviceAccountEnv);
        return admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } catch (error) {
         console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string.", error);
         throw new Error("Firebase Admin SDK initialization failed due to invalid config.");
      }
  }

  throw new Error("Firebase Admin SDK could not be initialized. Set either GOOGLE_APPLICATION_CREDENTIALS (for App Hosting) or FIREBASE_ADMIN_SDK_CONFIG (for local development).");
}


// This is a server-side function to fetch policy data from Firestore.
export async function getPolicyBySlug(slug: string): Promise<Policy | null> {
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const policyDoc = await db.collection('policies').doc(slug).get();

    if (!policyDoc.exists) {
      return null;
    }
    return policyDoc.data() as Policy;
  } catch (error) {
    console.error(`Failed to fetch policy for slug "${slug}":`, error);
    // In a production app, you might want to handle this more gracefully.
    // For now, we'll return null to allow the page to render a "not found" state.
    return null;
  }
}
