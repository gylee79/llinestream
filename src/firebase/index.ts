
'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, Firestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, FirebaseStorage, connectStorageEmulator } from 'firebase/storage';

interface FirebaseServices {
  firebaseApp: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase(): FirebaseServices {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const storage = getStorage(app);

  // In development, connect to emulators.
  // This is determined by the NEXT_PUBLIC_USE_EMULATORS environment variable.
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    // Check if emulators are not already running
    // NOTE: The private _isEmulatorRunning property is a hack, but it's the most
    // reliable way to check for this without causing a hot-reload loop.
    if (!(auth as any)._isEmulatorRunning) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    }
    if (!(firestore as any)._isEmulatorRunning) {
        connectFirestoreEmulator(firestore, 'localhost', 8080);
    }
    if (!(storage as any)._isEmulatorRunning) {
        connectStorageEmulator(storage, 'localhost', 9199);
    }
  }

  return {
    firebaseApp: app,
    auth: auth,
    firestore: firestore,
    storage: storage,
  };
}


export * from './provider';
export * from './client-provider';
export * from './hooks'; // Re-export from the new hooks file
export * from './errors';
export * from './error-emitter';
