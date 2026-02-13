'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

/**
 * Server Action to generate a signed URL for a Firebase Storage file.
 * This is necessary because client-side SDKs cannot generate signed URLs.
 *
 * @param token - The user's Firebase Auth ID token for verification.
 * @param videoId - The ID of the episode, used for context (optional, but good for logging/validation).
 * @param filePath - The full path to the file in Firebase Storage.
 * @returns An object with either the signedUrl or an error message.
 */
export async function getSignedUrl(
  token: string,
  videoId: string,
  filePath: string
): Promise<{ signedUrl?: string; error?: string }> {
  try {
    const adminApp = await initializeAdminApp();
    const auth = admin.auth(adminApp);
    const storage = admin.storage(adminApp);

    // Verify the user's token to ensure they are a legitimate user
    // This is a basic check; full subscription/access rights should be checked in the calling context if needed.
    await auth.verifyIdToken(token);

    if (!filePath) {
      throw new Error('File path is required.');
    }

    const [signedUrl] = await storage
      .bucket()
      .file(filePath)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
        virtualHostedStyle: true,
      });

    return { signedUrl };
    
  } catch (error: any) {
    console.error(`[getSignedUrl Error] for video ${videoId}, path ${filePath}:`, error);
    return { error: `Failed to get signed URL: ${error.message}` };
  }
}
