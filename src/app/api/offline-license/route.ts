
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User } from '@/lib/types';
import { add } from 'date-fns';
import { promisify } from 'util';

const hkdf = promisify(crypto.hkdf);

async function decryptMasterKey(encryptedMasterKeyB64: string): Promise<Buffer> {
    const kekSecret = process.env.KEK_SECRET;
    if (!kekSecret) throw new Error("KEK_SECRET is not configured on the server.");

    const kek = crypto.scryptSync(kekSecret, 'l-line-stream-kek-salt', 32);
    const encryptedBlob = Buffer.from(encryptedMasterKeyB64, 'base64');
    
    const iv = encryptedBlob.subarray(0, 12);
    const authTag = encryptedBlob.subarray(encryptedBlob.length - 16);
    const encryptedKey = encryptedBlob.subarray(12, encryptedBlob.length - 16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
}

export async function POST(req: NextRequest) {
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
    const episodeData = episodeDoc.data();
    
    const courseId = episodeData?.courseId;
    const subscription = userData.activeSubscriptions?.[courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData?.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required for download' }, { status: 403 });
    }

    // 4. Retrieve and Decrypt Master Key
    const keyId = episodeData?.encryption?.keyId;
    if (!keyId) {
        return NextResponse.json({ error: 'Not Found: Encryption info missing for this video' }, { status: 404 });
    }
    const keyDoc = await db.collection('video_keys').doc(keyId).get();
    if (!keyDoc.exists) {
      return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    }
    const videoKeyData = keyDoc.data() as VideoKey;
    const masterKey = await decryptMasterKey(videoKeyData.encryptedMasterKey);
    const salt = Buffer.from(videoKeyData.salt, 'base64');

    // 5. Generate Offline Derived Key using HKDF with a structured info
    const expiresAt = add(new Date(), { days: 7 });
    const info = Buffer.concat([
        Buffer.from("LSV_OFFLINE_V1"),
        Buffer.from(userId),
        Buffer.from(deviceId),
        Buffer.from(expiresAt.toISOString())
    ]);
    const offlineDerivedKey = await hkdf('sha256', masterKey, salt, info, 32);
    
    // 6. Generate Watermark Seed
    const watermarkSeed = crypto.createHash('sha256').update(userId).digest('hex');

    // 7. Return Offline License
    return NextResponse.json({
      offlineDerivedKey: offlineDerivedKey.toString('base64'),
      expiresAt: expiresAt.toISOString(),
      videoId: videoId,
      deviceId: deviceId,
      watermarkSeed: watermarkSeed,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[offline-license API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
