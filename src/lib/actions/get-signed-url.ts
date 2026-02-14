'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import type { User, Episode } from '@/lib/types';

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
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      });

    return { signedUrl };
    
  } catch (error: any) {
    console.error(`[getSignedUrl Error] for video ${videoId}, path ${filePath}:`, error);
    return { error: `Failed to get signed URL: ${error.message}` };
  }
}
