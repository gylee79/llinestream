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
import { FirestorePermissionError } from '@/firebase/errors';
import { useFirebase } from '@/firebase/provider'; 

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const { authUser } = useFirebase(); // Changed from useUser() to useFirebase()
  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    
    const internalQuery = (memoizedTargetRefOrQuery as any)._query;
    if (!internalQuery?.path || internalQuery.path.length === 0) {
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
    }

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
        const pathString = (memoizedTargetRefOrQuery as any)._query?.path?.toString() || 'unknown collection';
        const contextualError = new FirestorePermissionError({
          operation: 'list',
          path: pathString, 
        });

        setError(contextualError);
        setData(null);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [memoizedTargetRefOrQuery, authUser]); 
  
  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    if (process.env.NODE_ENV === 'development') {
        console.warn('Query was not properly memoized using useMemoFirebase. This can lead to performance issues and infinite re-renders.');
    }
  }
  return { data, isLoading, error };
}
