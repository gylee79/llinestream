
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';
import type { User, UserAuditLog, Timestamp } from '../types';

type UpdateResult = {
  success: boolean;
  message: string;
};

// Allow for potentially undefined fields coming from the user object
type ProfileDataType = {
    name?: string;
    phone?: string;
    dob?: string;
}

type UpdateProfilePayload = {
    userId: string;
    currentData: ProfileDataType;
    newData: ProfileDataType;
}

export async function updateUserProfileAndLog(payload: UpdateProfilePayload): Promise<UpdateResult> {
    const { userId, currentData, newData } = payload;
    if (!userId || !currentData || !newData) {
        return { success: false, message: '필수 정보가 누락되었습니다.' };
    }

    try {
        const adminApp = initializeAdminApp();
        const db = admin.firestore(adminApp);
        const userRef = db.collection('users').doc(userId);
        
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return { success: false, message: '사용자를 찾을 수 없습니다.' };
        }
        const user = userSnap.data() as User;

        const batch = db.batch();
        const changedFields: Partial<Record<keyof typeof newData, { oldValue: string; newValue: string }>> = {};

        // Compare fields and log changes
        (Object.keys(newData) as Array<keyof typeof newData>).forEach(key => {
            if (currentData[key] !== newData[key]) {
                const logRef = db.collection('user_audit_logs').doc();
                const logEntry: Omit<UserAuditLog, 'id'> = {
                    userId: userId,
                    userName: user.name, // Log with the name at the time of change
                    userEmail: user.email,
                    changedAt: admin.firestore.FieldValue.serverTimestamp() as Timestamp,
                    fieldName: key,
                    oldValue: currentData[key] || '',
                    newValue: newData[key] || ''
                };
                batch.set(logRef, logEntry);
            }
        });

        if (Object.keys(newData).length > 0) {
            batch.update(userRef, newData);
            await batch.commit();

            revalidatePath('/admin/users');
            revalidatePath(`/users/${userId}`);

            return { success: true, message: '프로필이 성공적으로 업데이트되었습니다.' };
        } else {
            return { success: true, message: '변경된 내용이 없어 업데이트하지 않았습니다.' };
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
        console.error('updateUserProfileAndLog Error:', errorMessage, error);
        return { success: false, message: `프로필 업데이트 실패: ${errorMessage}` };
    }
}
