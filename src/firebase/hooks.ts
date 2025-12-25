
'use client';

import { useEffect, useState, useMemo, type DependencyList } from 'react';
import { Auth, User as AuthUser, onAuthStateChanged } from 'firebase/auth';
import { FirebaseApp } from 'firebase/app';
import { Firestore, doc } from 'firebase/firestore';
import { FirebaseStorage } from 'firebase/storage';
import { useDoc as useFirestoreDoc } from './firestore/use-doc';
import type { User as AppUser } from '@/lib/types';
import { useFirebase } from './provider';


// Return type for useUser() - specific to user auth state
export interface UserHookResult {
  user: AppUser | null; // Firestore user profile
  authUser: AuthUser | null; // Raw Firebase Auth user
  isUserLoading: boolean;
  userError: Error | null;
}

/** Hook to access Firebase Auth instance. */
export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

/** Hook to access Firestore instance. */
export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

/** Hook to access Firebase Storage instance. */
export const useStorage = (): FirebaseStorage => {
    const { storage } = useFirebase();
    return storage;
}

/** Hook to access Firebase App instance. */
export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

/**
 * Hook specifically for accessing the authenticated user's state, including Firestore profile data.
 * This provides the full User object (with role), loading status, and any auth errors.
 * @returns {UserHookResult} Object with user, authUser, isUserLoading, userError.
 */
export const useUser = (): UserHookResult => {
  const { firestore } = useFirebase();
  const auth = useAuth();
  
  const [userAuthState, setUserAuthState] = useState<{
    authUser: AuthUser | null;
    isAuthLoading: boolean;
    authError: Error | null;
  }>({
    authUser: auth.currentUser,
    isAuthLoading: auth.currentUser === null, // if no user, we are likely loading
    authError: null,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => setUserAuthState({ authUser: user, isAuthLoading: false, authError: null }),
      (error) => setUserAuthState({ authUser: null, isAuthLoading: false, authError: error })
    );
    return () => unsubscribe();
  }, [auth]);

  const { authUser, isAuthLoading, authError } = userAuthState;
  
  const userDocRef = useMemoFirebase(() => {
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
    authUser,
    isUserLoading, 
    userError 
  };
};

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoized = useMemo(factory, deps);
  
  if(memoized && typeof memoized === 'object' && memoized !== null) {
    Object.defineProperty(memoized, '__memo', {
        value: true,
        writable: false,
        enumerable: false,
    });
  }
  
  return memoized;
}

export { useCollection } from './firestore/use-collection';
export { useDoc } from './firestore/use-doc';
