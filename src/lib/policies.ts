
'use server';

import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Policy } from '@/lib/types';

function initializeAdminApp(): App {
  const alreadyInitialized = getApps();
  if (alreadyInitialized.length > 0) {
    return alreadyInitialized[0];
  }

  // 배포 환경 (App Hosting) - GOOGLE_APPLICATION_CREDENTIALS가 자동으로 설정됨
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Initializing Firebase Admin with App Hosting credentials...');
    return admin.initializeApp();
  }

  // 로컬 개발 환경 - .env 파일에서 서비스 계정 키 사용
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (serviceAccountEnv) {
    try {
      // 환경 변수 문자열을 JSON 객체로 파싱
      const serviceAccount = JSON.parse(serviceAccountEnv);
      console.log('Initializing Firebase Admin with service account from .env...');
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (e: any) {
      throw new Error(`Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string. Error: ${e.message}`);
    }
  }

  // 어떤 초기화 방법도 사용할 수 없는 경우
  throw new Error(
    'Firebase Admin SDK initialization failed. Set either GOOGLE_APPLICATION_CREDENTIALS (for deployment) or FIREBASE_ADMIN_SDK_CONFIG (for local development) environment variables.'
  );
}

/**
 * Fetches a policy document from Firestore by its slug using the Admin SDK.
 * @param slug The slug of the policy to fetch ('terms', 'privacy', 'refund').
 * @returns The policy data or null if not found.
 */
export async function getPolicyBySlug(slug: string): Promise<Policy | null> {
  try {
    const adminApp = initializeAdminApp();
    const db = getFirestore(adminApp);
    const policyRef = db.collection('policies').doc(slug);
    const docSnap = await policyRef.get();

    if (!docSnap.exists) {
      console.warn(`Policy with slug "${slug}" not found in Firestore.`);
      return null;
    }

    // Firestore 문서 데이터를 반환하기 전에 Policy 타입으로 캐스팅
    const policyData = docSnap.data() as Omit<Policy, 'slug'>;
    return {
      ...policyData,
      slug: docSnap.id as 'terms' | 'privacy' | 'refund', // slug를 문서 ID로 설정
    };

  } catch (error) {
    console.error(`Error fetching policy "${slug}":`, error);
    // In case of error (e.g., config issue), return null to allow the page to show "not found".
    return null;
  }
}
