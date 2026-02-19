'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const MAX_SESSIONS_PER_USER = 2;
const SESSION_EXPIRATION_SECONDS = 90;

/**
 * Creates a new playback session for a user if they are below the concurrent session limit, using a Firestore transaction.
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
  const newSessionRef = sessionsRef.doc(); // Pre-generate an ID for the new session

  const cleanup = async (sessionId?: string) => {
    const idToDelete = sessionId || newSessionRef.id;
    await sessionsRef.doc(idToDelete).delete().catch(e => console.error(`Failed to cleanup session ${idToDelete}`, e));
  };

  try {
    await db.runTransaction(async (transaction) => {
      const now = Timestamp.now();
      const expirationThreshold = Timestamp.fromMillis(now.toMillis() - SESSION_EXPIRATION_SECONDS * 1000);

      const userSessionsQuery = sessionsRef.where('userId', '==', userId);
      const snapshot = await transaction.get(userSessionsQuery);

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
      
      // Clean up expired sessions within the same transaction
      if (expiredSessions.length > 0) {
        expiredSessions.forEach(doc => transaction.delete(doc.ref));
      }

      if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
        // Throwing an error inside a transaction automatically rolls it back.
        throw new Error('LIMIT_EXCEEDED');
      }

      const newSession = {
        userId,
        videoId,
        deviceId,
        startedAt: now,
        lastHeartbeat: now,
      };
      transaction.set(newSessionRef, newSession);
    });
    
    // If the transaction completes without errors, we are successful.
    return { 
      success: true, 
      message: '세션이 성공적으로 생성되었습니다.', 
      sessionId: newSessionRef.id,
      cleanup: () => cleanup(newSessionRef.id),
    };

  } catch (error: any) {
    console.error('createPlaySession Error:', error.message);
    if (error.message === 'LIMIT_EXCEEDED') {
      return { 
        success: false, 
        message: `동시 접속 가능한 기기 수(${MAX_SESSIONS_PER_USER}대)를 초과했습니다. 다른 기기에서 재생을 중지하고 다시 시도해주세요.`,
        cleanup: async () => {} 
      };
    }
    return { success: false, message: '세션 생성 중 서버 오류가 발생했습니다.', cleanup: async () => {} };
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
