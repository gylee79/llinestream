
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import type { User, Episode, VideoManifest } from '@/lib/types';

/**
 * Validates a user's permission and generates a short-lived Signed URL for a specific file.
 * SECURITY CRITICAL: This function is the gatekeeper for all video and AI content.
 * 
 * @param token The user's Firebase Auth ID token.
 * @param videoId The ID of the episode the user wants to access content for.
 * @param requestedPath The specific storage path of the file (e.g., 'episodes/xxx/segments/init.enc' or 'episodes/xxx/ai/search_data.json').
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

    // 3. Verify User's Access Rights for the episode
    const subscription = userData.activeSubscriptions?.[episodeData.courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!episodeData.isFree && !isSubscribed) {
       return { error: 'ERROR_UNAUTHORIZED_USER' };
    }

    // 4. SERVER-SIDE PATH VALIDATION (CRITICAL)
    const isVideoSegmentRequest = requestedPath.includes('/segments/');
    const isAiContentRequest = requestedPath.includes('/ai/');

    // Only perform manifest check for video segments. AI content path is checked differently.
    if (isVideoSegmentRequest) {
        // The manifest itself is also a protected asset. Check if the request is for the manifest.
        if (requestedPath === episodeData.storage.manifestPath) {
            // This is a valid request for the manifest file, proceed to generate URL.
        } else {
            // For segment requests, fetch the manifest to verify the segment is part of this episode.
            if (!episodeData.storage.manifestPath) {
                return { error: 'ERROR_MANIFEST_NOT_FOUND' };
            }
            const manifestFile = storage.bucket().file(episodeData.storage.manifestPath);
            const [manifestContent] = await manifestFile.download();
            const manifest: VideoManifest = JSON.parse(manifestContent.toString('utf8'));

            const validPaths = [manifest.init, ...manifest.segments.map(s => s.path)];
            if (!validPaths.includes(requestedPath)) {
                console.warn(`[SECURITY_ALERT] User ${userId} tried to access an invalid segment path '${requestedPath}' for video ${videoId}.`);
                return { error: 'ERROR_INVALID_PATH' };
            }
        }
    } else if (isAiContentRequest) {
        // For AI content, check if the requested path is one of the valid paths in resultPaths.
        const validAiPaths = Object.values(episodeData.ai.resultPaths || {});
        if (!validAiPaths.includes(requestedPath)) {
             console.warn(`[SECURITY_ALERT] User ${userId} tried to access an invalid AI content path '${requestedPath}' for video ${videoId}.`);
            return { error: 'ERROR_INVALID_PATH' };
        }
    }
    // No validation for other file types for now.

    // 5. Generate a short-lived Signed URL (60 seconds)
    const [signedUrl] = await storage
      .bucket()
      .file(requestedPath)
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
