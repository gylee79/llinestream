
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { EpisodeViewLog } from '../types';

type LogViewPayload = Omit<EpisodeViewLog, 'id' | 'endedAt' | 'duration'> & {
    endedAt: Date,
    startedAt: Date,
};

export async function logEpisodeView(payload: LogViewPayload): Promise<{ success: boolean, message: string }> {
  const { userId, userName, userEmail, episodeId, episodeTitle, courseId, startedAt, endedAt } = payload;
  
  if (!userId || !episodeId) {
    return { success: false, message: '사용자 ID와 에피소드 ID는 필수입니다.' };
  }

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);

    const logEntry: Omit<EpisodeViewLog, 'id'> = {
      userId,
      userName,
      userEmail,
      episodeId,
      episodeTitle,
      courseId,
      startedAt: admin.firestore.Timestamp.fromDate(new Date(startedAt)),
      endedAt: admin.firestore.Timestamp.fromDate(new Date(endedAt)),
      duration: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000), // duration in seconds
    };

    await db.collection('episode_view_logs').add(logEntry);

    return { success: true, message: '시청 기록이 성공적으로 저장되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('logEpisodeView Error:', errorMessage, error);
    return { success: false, message: `시청 기록 저장 실패: ${errorMessage}` };
  }
}
