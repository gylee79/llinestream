
'use client';

import { useState, useEffect } from 'react';
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

/**
 * React hook to subscribe to a Firestore collection or query in real-time.
 * Handles nullable references/queries.
 * 
 *
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *  
 * @template T Optional type for document data. Defaults to any.
 * @param {CollectionReference<DocumentData> | Query<DocumentData> | null | undefined} targetRefOrQuery -
 * The Firestore CollectionReference or Query. Waits if null/undefined.
 * @returns {UseCollectionResult<T>} Object with data, isLoading, error.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    // --- Start: Guard Clauses ---
    // 1. If the query object itself is missing, do nothing.
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    
    // 2. Add robust guard clauses to prevent invalid queries from reaching onSnapshot.
    // This prevents "INTERNAL ASSERTION FAILED: Unexpected state" errors.
    const internalQuery = (memoizedTargetRefOrQuery as any)._query;
    const path = internalQuery?.path;

    if (!path || path.length === 0) {
        // Path is invalid or points to the root, which is not a collection.
        // Silently ignore this query to prevent SDK crashes.
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
    }
    // --- End: Guard Clauses ---

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const results: ResultItemType[] = [];
        for (const doc of snapshot.docs) {
          results.push({ ...(doc.data() as T), id: doc.id });
        }
        setData(results);
        setError(null);
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        // 2. Improve error messaging by including the actual query path for easier debugging.
        const pathString = (memoizedTargetRefOrQuery as any)._query?.path?.toString() || 'unknown collection';
        const contextualError = new FirestorePermissionError({
          operation: 'list',
          path: pathString, 
        });

        setError(contextualError);
        setData(null);
        setIsLoading(false);

        // trigger global error propagation
        errorEmitter.emit('permission-error', contextualError);
      }
    );

    return () => unsubscribe();
  }, [memoizedTargetRefOrQuery]); 
  
  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    // This check is important for preventing infinite loops but we won't throw a hard error.
    // Instead, we log it to the console during development.
    if (process.env.NODE_ENV === 'development') {
        console.warn('Query was not properly memoized using useMemoFirebase. This can lead to performance issues and infinite re-renders.');
    }
  }
  return { data, isLoading, error };
}
