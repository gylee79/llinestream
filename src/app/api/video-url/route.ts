
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
    const decodedToken = await auth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const { videoId, fileName } = await req.json();
    if (!videoId || !fileName) {
      return NextResponse.json({ error: 'Bad Request: videoId and fileName are required' }, { status: 400 });
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

    const subscription = userData.activeSubscriptions?.[episodeData.courseId];
    const isSubscribed = subscription && new Date() < toJSDate(subscription.expiresAt)!;

    if (!isSubscribed && !episodeData.isFree) {
       return NextResponse.json({ error: 'Forbidden: Subscription required' }, { status: 403 });
    }

    // 3. Construct file path and generate Signed URL
    const filePath = fileName; // The path is now passed directly from client (e.g., episodes/{id}/manifest.json)
    if (!filePath) {
        return NextResponse.json({ error: 'Not Found: File path is missing in episode data.' }, { status: 404 });
    }

    const [signedUrl] = await storage
    .bucket()
    .file(filePath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      virtualHostedStyle: true, // Crucial for Range requests
    });

  return NextResponse.json({ signedUrl });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('[video-url API Error]', error);
    return NextResponse.json({ error: `Internal Server Error: ${errorMessage}` }, { status: 500 });
  }
}
