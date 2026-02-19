
'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const MAX_SESSIONS_PER_USER = 2;
const SESSION_EXPIRATION_SECONDS = 90;

/**
 * Creates a new playback session for a user if they are below the concurrent session limit.
 * Also cleans up expired sessions for the user.
 * @returns An object indicating success, a message, the new sessionId, and a cleanup function.
 */
export async function createPlaySession(
  userId: string,
  videoId: string,
  deviceId: string
): Promise<{ success: boolean; message: string; sessionId?: string; cleanup: () => Promise<void>; }> {
  const adminApp = await initializeAdminApp();
  const db = admin.firestore(adminApp);
  const sessionsRef = db.collection('play_sessions');

  const cleanup = async (sessionId?: string) => {
    if (sessionId) {
      await sessionsRef.doc(sessionId).delete().catch(e => console.error(`Failed to cleanup session ${sessionId}`, e));
    }
  };

  try {
    const now = Timestamp.now();
    const expirationThreshold = Timestamp.fromMillis(now.toMillis() - SESSION_EXPIRATION_SECONDS * 1000);

    const userSessionsQuery = sessionsRef.where('userId', '==', userId);
    const snapshot = await userSessionsQuery.get();

    const activeSessions: admin.firestore.QueryDocumentSnapshot[] = [];
    const expiredSessions: admin.firestore.QueryDocumentSnapshot[] = [];

    snapshot.forEach(doc => {
      const session = doc.data();
      if (session.lastHeartbeat && session.lastHeartbeat.toMillis() > expirationThreshold.toMillis()) {
        activeSessions.push(doc);
      } else {
        expiredSessions.push(doc);
      }
    });

    // Clean up expired sessions in the background (fire and forget)
    if (expiredSessions.length > 0) {
        const batch = db.batch();
        expiredSessions.forEach(doc => batch.delete(doc.ref));
        batch.commit().catch(e => console.error("Failed to cleanup expired sessions", e));
    }

    if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
      return { 
        success: false, 
        message: `동시 접속 가능한 기기 수(${MAX_SESSIONS_PER_USER}대)를 초과했습니다. 다른 기기에서 재생을 중지하고 다시 시도해주세요.`,
        cleanup: async () => {} 
      };
    }

    const newSessionRef = sessionsRef.doc();
    const newSession = {
      userId,
      videoId,
      deviceId,
      startedAt: now,
      lastHeartbeat: now,
    };
    await newSessionRef.set(newSession);

    return { 
      success: true, 
      message: '세션이 생성되었습니다.', 
      sessionId: newSessionRef.id,
      cleanup: () => cleanup(newSessionRef.id),
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('createPlaySession Error:', error);
    return { success: false, message, cleanup: async () => {} };
  }
}

/**
 * Updates the heartbeat of an active playback session.
 */
export async function heartbeatPlaySession(sessionId: string): Promise<{ success: boolean }> {
  if (!sessionId) return { success: false };
  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    await db.collection('play_sessions').doc(sessionId).update({
      lastHeartbeat: Timestamp.now(),
    });
    return { success: true };
  } catch (error) {
    // It's okay if this fails occasionally (e.g., session ended).
    return { success: false };
  }
}

/**
 * Ends and deletes a playback session document.
 */
export async function endPlaySession(sessionId: string): Promise<{ success: boolean }> {
  if (!sessionId) return { success: false };
  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    await db.collection('play_sessions').doc(sessionId).delete();
    return { success: true };
  } catch (error) {
    return { success: false };
  }
}
    