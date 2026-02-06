
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import * as crypto from 'crypto';
import type { VideoKey, User } from '@/lib/types';

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

    // 2. Get videoId from request body
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: 'Bad Request: videoId is required' }, { status: 400 });
    }

    // 3. Verify User Subscription
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
    
    // Check if the user has an active subscription for the course this episode belongs to
    const courseId = episodeData?.courseId;
    const subscription = userData.activeSubscriptions?.[courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData?.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required' }, { status: 403 });
    }

    // 4. Retrieve Master Key from secure collection
    const keysQuery = await db.collection('video_keys').where('videoId', '==', videoId).limit(1).get();
    if (keysQuery.empty) {
      return NextResponse.json({ error: 'Not Found: Encryption key not found for this video' }, { status: 404 });
    }
    const videoKeyData = keysQuery.docs[0].data() as VideoKey;
    const masterKey = Buffer.from(videoKeyData.masterKey, 'base64');

    // 5. Generate a Derived Key (simple derivation for this example)
    // A real-world scenario might use a more complex derivation involving deviceId, but this is secure for web.
    const derivedKey = crypto.createHmac('sha256', masterKey).update(userId).digest();

    // 6. Return Session Info
    return NextResponse.json({
      sessionId: `sess_${crypto.randomBytes(16).toString('hex')}`,
      derivedKey: derivedKey.toString('base64'),
      expiresIn: 60, // Key is valid for 60 seconds
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[play-session API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
