import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';
import { firebaseConfig } from '@/firebase/config';
import serviceAccount from './service-account.json';

// This is a global variable to hold the initialized Firebase Admin app instance.
// It ensures that we only initialize the app once per server instance.
let adminApp: App | null = null;

/**
 * Initializes and/or returns the singleton instance of the Firebase Admin SDK.
 * This function is safe to call from any server-side module and prevents re-initialization.
 * 
 * @returns {App} The initialized Firebase Admin App instance.
 * @throws {Error} If the required Firebase service account credentials are not set in environment variables.
 */
export function initializeAdminApp(): App {
  // If the app instance already exists, return it to avoid re-initialization.
  if (adminApp) {
    return adminApp;
  }

  // Check if getApps() can find an already initialized app. This is a robust check.
  const existingApps = getApps();
  if (existingApps.length > 0) {
    adminApp = existingApps[0];
    return adminApp;
  }

  // Explicitly use the imported service account credentials
  const serviceAccountCredentials = {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  };
  
  // Try to initialize the Admin SDK with the retrieved credentials.
  try {
    const newAdminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountCredentials),
      storageBucket: firebaseConfig.storageBucket,
    });

    console.log('Firebase Admin SDK initialized successfully using service-account.json.');
    adminApp = newAdminApp; // Store the new instance in our global variable.
    return adminApp;
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK from service-account.json:', error);
    // If initialization fails, throw an error with a clear message.
    throw new Error('Could not initialize Firebase Admin SDK. Please check your service account credentials.');
  }
}
