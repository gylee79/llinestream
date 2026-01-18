'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

export async function createFullBackup(): Promise<{ success: boolean; data?: string; message: string }> {
  console.log('Starting full data backup...');
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const backupData: { [key: string]: any[] } = {};

    const topLevelCollections = [
      'fields',
      'classifications',
      'courses',
      'episodes',
      'instructors',
      'policies',
      'episode_view_logs',
      'user_audit_logs'
    ];

    for (const collectionName of topLevelCollections) {
      console.log(`Backing up ${collectionName}...`);
      const snapshot = await db.collection(collectionName).get();
      backupData[collectionName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
    
    // Special handling for settings collection which has known doc IDs
    console.log(`Backing up settings...`);
    const settingsCollectionRef = db.collection('settings');
    const settingsSnapshot = await settingsCollectionRef.get();
    backupData['settings'] = settingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));


    console.log('Backing up users and their subcollections...');
    const usersSnapshot = await db.collection('users').get();
    const usersData = [];
    for (const userDoc of usersSnapshot.docs) {
      const userData = { id: userDoc.id, ...userDoc.data() };
      
      const subscriptionsSnapshot = await userDoc.ref.collection('subscriptions').get();
      (userData as any).subscriptions = subscriptionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const chatsSnapshot = await userDoc.ref.collection('chats').get();
      (userData as any).chats = chatsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const viewHistorySnapshot = await userDoc.ref.collection('viewHistory').get();
      (userData as any).viewHistory = viewHistorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      usersData.push(userData);
    }
    backupData['users'] = usersData;
    
    console.log('Backup data compiled successfully.');

    return { 
        success: true, 
        data: JSON.stringify(backupData, null, 2), 
        message: '백업 데이터가 성공적으로 생성되었습니다.' 
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('createFullBackup Error:', errorMessage, error);
    return { success: false, message: `백업 생성 실패: ${errorMessage}` };
  }
}
