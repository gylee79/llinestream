
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useAuth } from '@/firebase/hooks';

/** Utility type to add an 'id' field to a given type T. */
export type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useCollection hook.
 * @template T Type of the document data.
 */
export interface UseCollectionResult<T> {
  data: WithId<T>[] | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
}

/* Internal representation of a query, to safely access its path */
interface InternalQuery extends Query<DocumentData> {
    _query?: {
        path: {
            canonicalString(): string;
            toString(): string;
            segments: string[];
        }
    }
}

/**
 * React hook to subscribe to a Firestore collection or query in real-time.
 * Handles nullable references/queries.
 *
 * IMPORTANT! YOU MUST MEMOIZE the inputted targetRefOrQuery or BAD THINGS WILL HAPPEN.
 * Use useMemoFirebase to memoize it per React guidance. Also make sure that its dependencies are stable.
 *  
 * @template T Optional type for document data. Defaults to any.
 * @param {CollectionReference<DocumentData> | Query<DocumentData> | null | undefined} targetRefOrQuery -
 * The Firestore CollectionReference or Query. Waits if null/undefined.
 * @returns {UseCollectionResult<T>} Object with data, isLoading, error.
 */
export function useCollection<T = any>(
    targetRefOrQuery: CollectionReference<DocumentData> | Query<DocumentData> | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const auth = useAuth();
  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  const handleError = useCallback((err: FirestoreError) => {
    const path = targetRefOrQuery?.type === 'collection'
      ? (targetRefOrQuery as CollectionReference).path
      : ((targetRefOrQuery as InternalQuery)._query?.path?.canonicalString() || 'unknown path');
    
    // auth.currentUser is a stable reference within the auth object from context
    const currentUser = auth.currentUser;
    const contextualError = new FirestorePermissionError({
      operation: 'list',
      path,
    }, currentUser);

    setError(contextualError);
    setData(null);
    setIsLoading(false);

    // trigger global error propagation
    errorEmitter.emit('permission-error', contextualError);
  }, [targetRefOrQuery, auth]);

  useEffect(() => {
    // If the query is not ready, or is invalid, reset the state and wait.
    if (!targetRefOrQuery || !(targetRefOrQuery as InternalQuery)._query?.path.segments.length) {
      setData(null);
      setIsLoading(true);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const handleNext = (snapshot: QuerySnapshot<DocumentData>) => {
        const results: ResultItemType[] = snapshot.docs.map(doc => ({
            ...(doc.data() as T),
            id: doc.id
        }));
        setData(results);
        setError(null);
        setIsLoading(false);
    };

    const unsubscribe = onSnapshot(targetRefOrQuery, handleNext, handleError);

    return () => unsubscribe();
  }, [targetRefOrQuery, handleError]);

  return { data, isLoading, error };
}
