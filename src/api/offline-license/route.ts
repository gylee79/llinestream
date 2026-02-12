
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp, decryptMasterKey, loadKEK } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User, Episode, OfflineLicense } from '@/lib/types';
import { add } from 'date-fns';

export async function POST(req: NextRequest) {
  // This log is added to force a new deployment and refresh environment variables.
  console.log(`[API /api/offline-license] Received request at ${new Date().toISOString()}`);
  try {
    // Attempt to load the KEK early to fail fast if it's not configured.
    // This prevents other logic from running unnecessarily.
    try {
        await loadKEK();
    } catch (kekError: any) {
        console.error('[OFFLINE-LICENSE-PRECHECK-FAILURE]', kekError.message);
        // This is a server configuration error, so we return a 500.
        return NextResponse.json({ error: `서버 설정 오류: ${kekError.message}` }, { status: 500 });
    }

    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const auth = admin.auth(adminApp);

    // 1. Verify User Authentication
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const idToken = authorization.split('Bearer ')[1];

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
    const userId = decodedToken.uid;

    // 2. Get videoId and deviceId from request body
    const { videoId, deviceId } = await req.json();
    if (!videoId || !deviceId) {
      return NextResponse.json({ error: 'Bad Request: videoId and deviceId are required' }, { status: 400 });
    }

    // 3. Verify User Subscription and Download Rights
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'Forbidden: User not found' }, { status: 403 });
    }
    const userData = userDoc.data() as User;
    
    const episodeDoc = await db.collection('episodes').doc(videoId).get();
    if (!episodeDoc.exists) {
        return NextResponse.json({ error: 'Not Found: Video not found' }, { status: 404 });
    }
    const episodeData = episodeDoc.data() as Episode;
    
    const courseId = episodeData.courseId;
    const subscription = userData.activeSubscriptions?.[courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required for download' }, { status: 403 });
    }

    // 4. Retrieve and Decrypt Master Key
    const keyId = episodeData.encryption.keyId;
    if (!keyId) {
        return NextResponse.json({ error: 'Not Found: Encryption info missing for this video' }, { status: 404 });
    }
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) {
      return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    }
    const videoKeyData = keyDoc.data() as VideoKey;
    if (!videoKeyData.encryptedMasterKey) {
        return NextResponse.json({ error: 'Internal Server Error: Master key is missing from key data.' }, { status: 500 });
    }
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);

    // 5. Generate Signature for the license
    const issuedAt = Date.now();
    const expiresAt = add(issuedAt, { days: 7 }).getTime();
    const signaturePayload = JSON.stringify({ videoId, userId, deviceId, expiresAt });
    // In a real scenario, use a private key for signing
    // For this example, we'll use a HMAC with a secret from env.
    const signature = crypto.createHmac('sha256', await loadKEK()).update(signaturePayload).digest('hex');

    // 6. Construct and return Offline License
    const license: Omit<OfflineLicense, 'signature' | 'offlineDerivedKey'> & { signature: string } = {
      videoId,
      userId,
      deviceId,
      issuedAt,
      expiresAt,
      keyId: videoKeyData.keyId,
      kekVersion: videoKeyData.kekVersion,
      policy: {
          maxDevices: 1,
          allowScreenCapture: false
      },
      signature: signature,
    };

    // CRITICAL FIX: Send the actual masterKey for decryption, not a derived one.
    return NextResponse.json({
        ...license,
        offlineDerivedKey: masterKey.toString('base64'),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[offline-license API Error]', error);
    // Return a 500 for any other unexpected errors during processing.
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}

