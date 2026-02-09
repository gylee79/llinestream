'use server';

import * as admin from 'firebase-admin';
import { getApps, App } from 'firebase-admin/app';
import { firebaseConfig } from '@/firebase/config';
import * as crypto from 'crypto';

const ADMIN_APP_NAME = 'firebase-admin-app-rsc';

// --- KEK Loading and Decryption Logic ---
let cachedKEK: Buffer | null = null;

function validateKEK(key: Buffer): void {
    if (key.length !== 32) {
        // Do not log the key or its length for security reasons.
        throw new Error('Invalid KEK format.');
    }
}

/**
 * Loads the Key Encryption Key (KEK) from environment variables.
 * This is a critical server-side function. The KEK is expected to be a 32-byte key, Base64 encoded.
 * It's cached in memory after the first load for performance.
 * @returns {Promise<Buffer>} A promise that resolves with the KEK Buffer.
 */
export async function loadKEK(): Promise<Buffer> {
    if (cachedKEK) {
        return cachedKEK;
    }
    
    const kekSecret = process.env.KEK_SECRET;
    
    if (kekSecret) {
        console.log("KEK_SECRET found in Next.js server environment. Loading and validating key.");
        const key = Buffer.from(kekSecret, 'base64');
        validateKEK(key);
        cachedKEK = key;
        return cachedKEK;
    }

    console.error("CRITICAL: KEK_SECRET environment variable is not configured for the Next.js server environment.");
    throw new Error("KEK_SECRET is not configured. Cannot decrypt master keys.");
}

/**
 * Decrypts a master key that was encrypted with the KEK.
 * @param encryptedMasterKeyB64 The Base64-encoded encrypted master key blob.
 * @returns {Promise<Buffer>} A promise that resolves with the decrypted master key.
 */
export async function decryptMasterKey(encryptedMasterKeyB64: string): Promise<Buffer> {
    const kek = await loadKEK();
    const encryptedMasterKeyBlob = Buffer.from(encryptedMasterKeyB64, 'base64');
    
    const kekIv = encryptedMasterKeyBlob.subarray(0, 12);
    const kekAuthTag = encryptedMasterKeyBlob.subarray(encryptedMasterKeyBlob.length - 16);
    const encryptedKey = encryptedMasterKeyBlob.subarray(12, encryptedMasterKeyBlob.length - 16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, kekIv);
    decipher.setAuthTag(kekAuthTag);
    
    const decryptedKey = Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
    return decryptedKey;
}


/**
 * Initializes and/or returns the singleton instance of the Firebase Admin SDK for RSC.
 * This function is safe to call from any server-side module and prevents re-initialization.
 * It uses a named app instance to avoid conflicts with default initializations by other libraries.
 * 
 * @returns {Promise<App>} A promise that resolves with the initialized Firebase Admin App instance.
 * @throws {Error} If the required Firebase service account credentials are not set in environment variables.
 */
export async function initializeAdminApp(): Promise<App> {
  // Find the named app if it already exists.
  const existingApp = getApps().find(app => app.name === ADMIN_APP_NAME);
  if (existingApp) {
    return existingApp;
  }

  // Use environment variables for credentials
  const credentials = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  if (!credentials.projectId || !credentials.clientEmail || !credentials.privateKey) {
    throw new Error('Firebase Admin SDK credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are not set in environment variables.');
  }
  
  // Try to initialize the Admin SDK with the retrieved credentials and a unique name.
  try {
    const newApp = admin.initializeApp({
      credential: admin.credential.cert(credentials as admin.ServiceAccount),
      storageBucket: firebaseConfig.storageBucket,
    }, ADMIN_APP_NAME); // <-- Give the app a unique name

    console.log(`Firebase Admin SDK ('${ADMIN_APP_NAME}') initialized successfully.`);
    return newApp;
  } catch (error) {
    console.error(`Error initializing Firebase Admin SDK ('${ADMIN_APP_NAME}'):`, error);
    // If initialization fails, throw an error with a clear message.
    throw new Error('Could not initialize Firebase Admin SDK. Please check your credentials.');
  }
}

    