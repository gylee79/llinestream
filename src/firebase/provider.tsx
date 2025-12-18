
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore, doc } from 'firebase/firestore';
import { Auth, User as AuthUser, onAuthStateChanged } from 'firebase/auth';
import { FirebaseStorage } from 'firebase/storage';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener'
import { useDoc as useFirestoreDoc } from './firestore/use-doc'; 
import type { User as AppUser } from '@/lib/types';


interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
}

interface UserAuthState {
  authUser: AuthUser | null;
  isAuthLoading: boolean;
  authError: Error | null;
}

export interface FirebaseContextState {
  areServicesAvailable: boolean;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  storage: FirebaseStorage | null;
  authUser: AuthUser | null;
  isAuthLoading: boolean;
  authError: Error | null;
}

export interface FirebaseServicesAndUser {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  authUser: AuthUser | null;
  isAuthLoading: boolean;
  authError: Error | null;
}

export interface UserHookResult {
  user: AppUser | null;
  authUser: AuthUser | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
  storage,
}) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    authUser: null,
    isAuthLoading: true,
    authError: null,
  });

  useEffect(() => {
    if (!auth) {
      setUserAuthState({ authUser: null, isAuthLoading: false, authError: new Error("Auth service not provided.") });
      return;
    }

    setUserAuthState({ authUser: null, isAuthLoading: true, authError: null });

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUserAuthState({ authUser: firebaseUser, isAuthLoading: false, authError: null });
      },
      (error) => {
        console.error("FirebaseProvider: onAuthStateChanged error:", error);
        setUserAuthState({ authUser: null, isAuthLoading: false, authError: error });
      }
    );
    return () => unsubscribe();
  }, [auth]);

  const contextValue = useMemo((): FirebaseContextState => {
    const servicesAvailable = !!(firebaseApp && firestore && auth && storage);
    return {
      areServicesAvailable: servicesAvailable,
      firebaseApp: servicesAvailable ? firebaseApp : null,
      firestore: servicesAvailable ? firestore : null,
      auth: servicesAvailable ? auth : null,
      storage: servicesAvailable ? storage : null,
      authUser: userAuthState.authUser,
      isAuthLoading: userAuthState.isAuthLoading,
      authError: userAuthState.authError,
    };
  }, [firebaseApp, firestore, auth, storage, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }

  if (!context.areServicesAvailable || !context.firebaseApp || !context.firestore || !context.auth || !context.storage) {
    throw new Error('Firebase core services not available. Check FirebaseProvider props.');
  }

  return {
    firebaseApp: context.firebaseApp,
    firestore: context.firestore,
    auth: context.auth,
    storage: context.storage,
    authUser: context.authUser,
    isAuthLoading: context.isAuthLoading,
    authError: context.authError,
  };
};

export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

export const useStorage = (): FirebaseStorage => {
    const { storage } = useFirebase();
    return storage;
}

export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

export const useUser = (): UserHookResult => {
  const { firestore, authUser, isAuthLoading, authError } = useFirebase();
  
  const userDocRef = useMemo(() => {
    if (firestore && authUser) {
      return doc(firestore, 'users', authUser.uid);
    }
    return null;
  }, [firestore, authUser]);

  const { data: userProfile, isLoading: isProfileLoading, error: profileError } = useFirestoreDoc<AppUser>(userDocRef);

  const isUserLoading = isAuthLoading || (!!authUser && isProfileLoading);
  const userError = authError || profileError;

  return { 
    user: userProfile,
    authUser: authUser,
    isUserLoading, 
    userError 
  };
};
