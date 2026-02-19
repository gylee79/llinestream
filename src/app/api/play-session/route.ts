
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp, decryptMasterKey } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { VideoKey } from '@/lib/types';
import { createPlaySession } from '@/lib/actions/session-actions';

/**
 * Handles the initiation of a video playback session.
 * 1. Verifies user authentication.
 * 2. Checks for concurrent session limits using `createPlaySession`.
 * 3. If allowed, fetches and decrypts the master key for the video.
 * 4. Returns the master key and a new session ID to the client.
 */
export async function POST(req: NextRequest) {
  console.log(`[API /api/play-session] Received request at ${new Date().toISOString()}`);
  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const auth = admin.auth(adminApp);

    // 1. Verify User Authentication
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'ERROR_UNAUTHORIZED_TOKEN', message: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const idToken = authorization.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const { videoId, deviceId } = await req.json();
    if (!videoId || !deviceId) {
      return NextResponse.json({ error: 'ERROR_BAD_REQUEST', message: 'Bad Request: videoId and deviceId are required' }, { status: 400 });
    }

    // 2. Attempt to create a new play session (handles concurrent session logic)
    const sessionResult = await createPlaySession(userId, videoId, deviceId);
    if (!sessionResult.success || !sessionResult.sessionId) {
        return NextResponse.json({ error: 'ERROR_SESSION_LIMIT_EXCEEDED', message: sessionResult.message }, { status: 429 });
    }
    
    // 3. Fetch Episode and Key data
    const episodeDoc = await db.collection('episodes').doc(videoId).get();
    if (!episodeDoc.exists) {
        await sessionResult.cleanup(); // Clean up the created session if video doesn't exist
        return NextResponse.json({ error: 'ERROR_VIDEO_NOT_FOUND', message: 'Video not found' }, { status: 404 });
    }
    const episodeData = episodeDoc.data();

    const keyId = episodeData?.encryption?.keyId;
    if (!keyId) {
        await sessionResult.cleanup();
        return NextResponse.json({ error: 'ERROR_KEY_INFO_MISSING', message: 'Encryption info missing for this video' }, { status: 404 });
    }
    
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) {
        await sessionResult.cleanup();
        return NextResponse.json({ error: 'ERROR_KEY_NOT_FOUND', message: 'Encryption key not found for this video' }, { status: 404 });
    }
    
    // 4. Decrypt and return Master Key + Session ID
    const videoKeyData = keyDoc.data() as VideoKey;
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);
    
    return NextResponse.json({
      sessionId: sessionResult.sessionId,
      masterKeyB64: masterKey.toString('base64'),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[play-session API Error]', error);
    return NextResponse.json({ error: 'ERROR_INTERNAL_SERVER', message: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
