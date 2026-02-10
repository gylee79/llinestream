'use server';

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { revalidatePath } from 'next/cache';

type UpdateInstructorPayload = {
    id: string;
    name: string;
    email: string;
    phone: string;
    dob: string;
}

export async function updateInstructor(payload: UpdateInstructorPayload): Promise<{ success: boolean; message: string }> {
  const { id, name, email, phone, dob } = payload;
  
  if (!id) {
    return { success: false, message: '강사 ID가 필요합니다.' };
  }

  try {
    const adminApp = await initializeAdminApp();
    const db = admin.firestore(adminApp);
    const instructorRef = db.collection('instructors').doc(id);

    await instructorRef.update({
      name,
      email,
      phone,
      dob,
    });

    revalidatePath('/admin/content');
    return { success: true, message: '강사 정보가 성공적으로 업데이트되었습니다.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 서버 오류가 발생했습니다.';
    console.error('updateInstructor Error:', errorMessage, error);
    return { success: false, message: `강사 정보 업데이트 실패: ${errorMessage}` };
  }
}
