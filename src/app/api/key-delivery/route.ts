
import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { User } from '@/lib/types';

async function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const episodeId = searchParams.get('episodeId');
  const authHeader = req.headers.get('Authorization');

  if (!episodeId) {
    return new NextResponse('Missing episodeId', { status: 400 });
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new NextResponse('Unauthorized: Missing or invalid token', { status: 401 });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const adminApp = await initializeAdminApp();
    const auth = admin.auth(adminApp);
    const db = admin.firestore(adminApp);

    // 1. Verify user token
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    // 2. Fetch episode and user data in parallel
    const episodeRef = db.collection('episodes').doc(episodeId);
    const userRef = db.collection('users').doc(userId);
    
    const [episodeDoc, userDoc] = await Promise.all([
        episodeRef.get(),
        userRef.get()
    ]);

    if (!episodeDoc.exists) {
        return new NextResponse('Episode not found', { status: 404 });
    }
    if (!userDoc.exists) {
        return new NextResponse('User not found', { status: 404 });
    }

    const episodeData = episodeDoc.data()!;
    const userData = userDoc.data() as User;
    const courseId = episodeData.courseId;

    // 3. Check authorization (Is episode free? Is user an admin? Does user have an active subscription?)
    const isAdmin = userData.role === 'admin';
    const activeSub = userData.activeSubscriptions?.[courseId];
    const isSubscribed = activeSub && new Date() < activeSub.expiresAt.toDate();

    if (!episodeData.isFree && !isAdmin && !isSubscribed) {
      return new NextResponse('Forbidden: Subscription required', { status: 403 });
    }

    // 4. Get the private key from storage
    const keyPath = episodeData.keyPath;
    if (!keyPath) {
      return new NextResponse('Encryption key path not found for this episode', { status: 500 });
    }

    const storage = admin.storage(adminApp);
    const bucket = storage.bucket();
    const file = bucket.file(keyPath);
    
    const [keyBuffer] = await file.download();

    // 5. Stream the key back to the client
    return new NextResponse(keyBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600', // Cache key for 1 hour
      },
    });

  } catch (error: any) {
    console.error('[/api/key-delivery] Error:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        return new NextResponse('Unauthorized: Invalid token', { status: 401 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export { handler as GET };
