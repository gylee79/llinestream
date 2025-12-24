
'use server';

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

  // Temporarily bypass environment variable checks for reset
  console.warn("Firebase Admin SDK is not configured. Some server-side features will not work.");

  // Return a dummy app object or throw an error if needed, for now, we try to initialize with what we have
  try {
     const adminApp = admin.initializeApp();
     return adminApp;
  } catch(error) {
      console.error("Dummy Firebase Admin SDK initialization failed:", error);
      // This will likely fail but prevents app from crashing if called.
      // A proper setup is required.
      throw new Error('Firebase Admin SDK is not configured. Please set up the environment variables.');
  }
}
