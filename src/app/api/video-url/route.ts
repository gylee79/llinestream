'use server';
import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { toJSDate } from '@/lib/date-helpers';
import type { User, Episode } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const adminApp = await initializeAdminApp();
    const auth = admin.auth(adminApp);
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);

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

    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: 'Bad Request: videoId is required' }, { status: 400 });
    }

    // 2. Verify Subscription/Access Rights
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

    const courseId = episodeData?.courseId;
    const subscription = userData.activeSubscriptions?.[courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData?.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required' }, { status: 403 });
    }

    // 3. Generate Signed URL for the private file
    const encryptedPath = episodeData.storage?.encryptedPath;
    if (!encryptedPath) {
        return NextResponse.json({ error: 'Not Found: Encrypted video path is missing.' }, { status: 404 });
    }

    const [signedUrl] = await storage
      .bucket()
      .file(encryptedPath)
      .getSignedUrl({
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
      });

    return NextResponse.json({ signedUrl });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[video-url API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
