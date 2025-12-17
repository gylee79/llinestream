
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

  // App Hosting provides GOOGLE_APPLICATION_CREDENTIALS automatically.
  // When running on App Hosting, admin.initializeApp() will use these
  // credentials to initialize, giving the server admin privileges.
  return admin.initializeApp();
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
