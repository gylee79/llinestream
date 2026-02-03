
import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

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

  // Emulator connection logic has been removed to ensure a stable connection
  // to production Firebase services in all environments.

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
