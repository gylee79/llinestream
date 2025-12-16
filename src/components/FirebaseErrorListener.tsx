'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It throws any received error to be caught by Next.js's global-error.tsx.
 * This component does not and should not perform any data fetching itself.
 */
export function FirebaseErrorListener() {
  const [errorToThrow, setErrorToThrow] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      // When a permission error is emitted from anywhere in the app,
      // set it in our state. This will trigger a re-render.
      setErrorToThrow(error);
    };

    // Subscribe to the global permission-error event.
    errorEmitter.on('permission-error', handleError);

    // Clean up the subscription when the component unmounts.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []); // The empty dependency array ensures this effect runs only once on mount.

  // If an error has been set in our state, throw it.
  // React's error boundary (global-error.tsx in Next.js) will catch this.
  if (errorToThrow) {
    throw errorToThrow;
  }

  // This component renders nothing to the DOM.
  return null;
}
