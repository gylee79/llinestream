
import { NextRequest, NextResponse } from 'next/server';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Episode, User } from '@/lib/types';
import { toJSDate } from '@/lib/date-helpers';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const episodeId = searchParams.get('episodeId');
    const authorization = req.headers.get('Authorization');

    if (!episodeId) {
        return new NextResponse('Episode ID is required', { status: 400 });
    }
    if (!authorization || !authorization.startsWith('Bearer ')) {
        return new NextResponse('Authorization token is required', { status: 401 });
    }

    const token = authorization.split('Bearer ')[1];
    
    try {
        const adminApp = await initializeAdminApp();
        const auth = admin.auth(adminApp);
        const db = admin.firestore(adminApp);
        const storage = admin.storage(adminApp);

        // 1. Verify user token
        const decodedToken = await auth.verifyIdToken(token);
        const userId = decodedToken.uid;
        
        // 2. Fetch episode and user data
        const episodeRef = db.collection('episodes').doc(episodeId);
        const userRef = db.collection('users').doc(userId);
        
        const [episodeDoc, userDoc] = await Promise.all([episodeRef.get(), userRef.get()]);

        if (!episodeDoc.exists) {
            return new NextResponse('Episode not found', { status: 404 });
        }
        if (!userDoc.exists) {
            return new NextResponse('User not found', { status: 404 });
        }

        const episode = episodeDoc.data() as Episode;
        const user = userDoc.data() as User;
        const keyPath = episode.keyPath;
        
        if (!keyPath) {
            return new NextResponse('Encryption key path not found for this episode', { status: 500 });
        }

        // 3. Check authorization
        const userSubscription = user.activeSubscriptions?.[episode.courseId];
        const expiryDate = userSubscription ? toJSDate(userSubscription.expiresAt) : null;
        const isSubscribed = !!expiryDate && new Date() < expiryDate;
        
        if (user.role !== 'admin' && !episode.isFree && !isSubscribed) {
            return new NextResponse('You are not authorized to view this content', { status: 403 });
        }

        // 4. Fetch the private key and serve it
        const file = storage.bucket().file(keyPath);
        const [keyBuffer] = await file.download();

        return new NextResponse(keyBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
            },
        });

    } catch (error: any) {
        console.error(`[Key Delivery Error] for episode ${episodeId}:`, error);
        
        if (error.code === 'auth/id-token-expired') {
            return new NextResponse('Authentication token has expired', { status: 401 });
        }
        if (error.code === 'auth/argument-error') {
            return new NextResponse('Invalid authentication token', { status: 401 });
        }

        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
