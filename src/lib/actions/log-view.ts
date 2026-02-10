'use server';

import 'server-only';
import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { EpisodeViewLog } from '../types';

type LogViewPayload = Omit<EpisodeViewLog, 'id' | 'endedAt' | 'duration' | 'startedAt'> & {
    endedAt: Date,
    startedAt: Date,
};

export async function logEpisodeView(payload: LogViewPayload): Promise<{ success: boolean, message: string }> {
  const { userId, userName, userEmail, episodeId, episodeTitle, courseId, startedAt, endedAt } = payload;
  
  if (!userId || !episodeId || !courseId) {
    return { success: false, message: '사용자 ID, 에피소드 ID, 강좌 ID는 필수입니다.' };
  }
  
  const duration = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);

  // 시청 시간이 5초 미만인 경우 기록하지 않음
  if (duration < 5) {
      return { success: true, message: '시청 시간이 짧아 기록되지 않았습니다.' };
  }

  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const batch = db.batch();

    const logId = db.collection('episode_view_logs').doc().id;

    const logEntry: Omit<EpisodeViewLog, 'id'> = {
      userId,
      userName,
      userEmail,
      episodeId,
      episodeTitle,
      courseId,
      startedAt: admin.firestore.Timestamp.fromDate(new Date(startedAt)),
      endedAt: admin.firestore.Timestamp.fromDate(new Date(endedAt)),
      duration,
    };
    
    // 1. Store log in the user's subcollection for their personal history
    const userLogRef = db.collection('users').doc(userId).collection('viewHistory').doc(logId);
    batch.set(userLogRef, { ...logEntry, id: logId });

    // 2. Store log in the global collection for admin auditing
    const adminLogRef = db.collection('episode_view_logs').doc(logId);
    batch.set(adminLogRef, { ...logEntry, id: logId });
    
    await batch.commit();

    return { success: true, message: '시청 기록이 성공적으로 저장되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('logEpisodeView Error:', errorMessage, error);
    return { success: false, message: `시청 기록 저장 실패: ${errorMessage}` };
  }
}
