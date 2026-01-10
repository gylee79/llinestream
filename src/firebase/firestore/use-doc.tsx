
'use client';
    
import { useState, useEffect, useCallback } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useAuth } from '@/firebase/hooks';

/** Utility type to add an 'id' field to a given type T. */
type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useDoc hook.
 * @template T Type of the document data.
 */
export interface UseDocResult<T> {
  data: WithId<T> | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
}

/**
 * React hook to subscribe to a single Firestore document in real-time.
 * Handles nullable references.
 * 
 * IMPORTANT! YOU MUST MEMOIZE the inputted docRef or BAD THINGS WILL HAPPEN
 * use useMemoFirebase to memoize it per React guidence. Also make sure that its dependencies are stable
 * references
 *
 *
 * @template T Optional type for document data. Defaults to any.
 * @param {DocumentReference<DocumentData> | null | undefined} docRef -
 * The Firestore DocumentReference. Waits if null/undefined.
 * @returns {UseDocResult<T>} Object with data, isLoading, error.
 */
export function useDoc<T = any>(
  docRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  type StateDataType = WithId<T> | null;
  const auth = useAuth(); // Use the auth instance directly

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const handleNext = useCallback((snapshot: DocumentSnapshot<DocumentData>) => {
    if (snapshot.exists()) {
      setData({ ...(snapshot.data() as T), id: snapshot.id });
    } else {
      setData(null);
    }
    setError(null);
    setIsLoading(false);
  }, []);

  const handleError = useCallback((err: FirestoreError) => {
    if (docRef) {
      const contextualError = new FirestorePermissionError({
        operation: 'get',
        path: docRef.path,
      }, auth.currentUser); // Get the currentUser at the moment of error
      setError(contextualError);
      errorEmitter.emit('permission-error', contextualError);
    } else {
      setError(err);
    }
    setData(null);
    setIsLoading(false);
  }, [docRef, auth]);

  useEffect(() => {
    // If the ref is not ready, reset the state and wait.
    if (!docRef) {
      setData(null);
      setIsLoading(true); // Keep loading until a valid ref is provided
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(docRef, handleNext, handleError);

    return () => unsubscribe();
  }, [docRef, handleNext, handleError]); // Re-run if the docRef changes.

  return { data, isLoading, error };
}
