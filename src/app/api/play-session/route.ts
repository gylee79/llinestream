
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp, decryptMasterKey } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User, Episode } from '@/lib/types';

export async function POST(req: NextRequest) {
  console.log(`[API /api/play-session] Received request at ${new Date().toISOString()}`);
  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const auth = admin.auth(adminApp);

    // 1. Verify User Authentication
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const idToken = authorization.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // 2. Get videoId and deviceId
    const { videoId, deviceId } = await req.json();
    if (!videoId || !deviceId) {
      return NextResponse.json({ error: 'Bad Request: videoId and deviceId are required' }, { status: 400 });
    }

    // 3. Verify User Subscription & Video Playability
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return NextResponse.json({ error: 'Forbidden: User not found' }, { status: 403 });
    const userData = userDoc.data() as User;
    
    const episodeDoc = await db.collection('episodes').doc(videoId).get();
    if (!episodeDoc.exists) return NextResponse.json({ error: 'Not Found: Video not found' }, { status: 404 });
    const episodeData = episodeDoc.data() as Episode;
    
    if (!episodeData.status.playable) {
        return NextResponse.json({ error: `Forbidden: Video is not playable. Current status: ${episodeData.status.pipeline}` }, { status: 403 });
    }

    const subscription = userData.activeSubscriptions?.[episodeData.courseId];
    const isSubscribed = subscription && new Date() < (toJSDate(subscription.expiresAt) || new Date(0));

    if (!isSubscribed && !episodeData.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required' }, { status: 403 });
    }

    // 4. Retrieve and Decrypt Master Key
    const keyId = episodeData.encryption?.keyId;
    if (!keyId) return NextResponse.json({ error: 'Not Found: Encryption info missing for this video' }, { status: 404 });
    
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    
    const videoKeyData = keyDoc.data() as VideoKey;
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);

    // 5. Generate a session ID and Watermark Seed
    const sessionId = `online_sess_${crypto.randomBytes(12).toString('hex')}`;
    const watermarkSeed = crypto.createHash('sha256').update(`${userId}|${videoId}|${deviceId}|${sessionId}`).digest('hex');
    
    // CRITICAL FIX: Send the actual masterKey for decryption, not a derived one.
    const derivedKeyB64 = masterKey.toString('base64');

    // 7. Return Session Info
    return NextResponse.json({
      sessionId: sessionId,
      derivedKeyB64: derivedKeyB64,
      expiresAt: Date.now() + 3600 * 1000,
      watermarkSeed: watermarkSeed,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[play-session API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
