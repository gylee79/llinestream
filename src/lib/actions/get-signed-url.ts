
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import type { User, Episode, VideoManifest } from '@/lib/types';

/**
 * Validates a user's permission and generates a short-lived Signed URL for a specific video segment.
 * SECURITY CRITICAL: This function is the gatekeeper for all video content.
 * 
 * @param token The user's Firebase Auth ID token.
 * @param videoId The ID of the episode the user wants to access.
 * @param requestedPath The specific storage path of the segment (e.g., 'episodes/xxx/segments/init.enc').
 * @returns An object containing the signedUrl or an error code.
 */
export async function getSignedUrl(
  token: string,
  videoId: string,
  requestedPath: string
): Promise<{ signedUrl?: string; error?: string }> {
  try {
    const adminApp = await initializeAdminApp();
    const auth = admin.auth(adminApp);
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);

    // 1. Verify User Authentication
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    // 2. Fetch Episode and User data in parallel
    const [episodeDoc, userDoc] = await Promise.all([
        db.collection('episodes').doc(videoId).get(),
        db.collection('users').doc(userId).get()
    ]);

    if (!episodeDoc.exists) {
        return { error: 'ERROR_VIDEO_NOT_FOUND' };
    }
    if (!userDoc.exists) {
        return { error: 'ERROR_USER_NOT_FOUND' };
    }

    const episodeData = episodeDoc.data() as Episode;
    const userData = userDoc.data() as User;

    // 3. Verify User's Access Rights
    const subscription = userData.activeSubscriptions?.[episodeData.courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!episodeData.isFree && !isSubscribed) {
       return { error: 'ERROR_UNAUTHORIZED_USER' };
    }

    // 4. SERVER-SIDE PATH VALIDATION (CRITICAL)
    // Fetch the manifest from storage to verify the requested path belongs to this video.
    // This prevents a user from using a valid session for one video to request segments from another.
    if (requestedPath.startsWith('episodes/')) { // Only validate video segments, not other files like AI results
        if (!episodeData.storage.manifestPath) {
            return { error: 'ERROR_MANIFEST_NOT_FOUND' };
        }
        const manifestFile = storage.bucket().file(episodeData.storage.manifestPath);
        const [manifestContent] = await manifestFile.download();
        const manifest: VideoManifest = JSON.parse(manifestContent.toString('utf8'));

        const validPaths = [manifest.init, ...manifest.segments.map(s => s.path)];
        if (!validPaths.includes(requestedPath)) {
            console.warn(`[SECURITY_ALERT] User ${userId} tried to access an invalid path '${requestedPath}' for video ${videoId}.`);
            return { error: 'ERROR_INVALID_PATH' };
        }
    }


    // 5. Generate a short-lived Signed URL (60 seconds)
    const [signedUrl] = await storage
      .bucket()
      .file(requestedPath) // Use the validated path
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 1000, // 60 seconds
      });

    return { signedUrl };
    
  } catch (error: any) {
    console.error(`[getSignedUrl Error] for video ${videoId}, path ${requestedPath}:`, error);
    return { error: `ERROR_SIGNED_URL_FAILED: ${error.message}` };
  }
}
    