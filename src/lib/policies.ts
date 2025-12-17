import 'server-only';
import * as admin from 'firebase-admin';
import { initializeAdminApp } from '@/lib/firebase-admin';
import type { Policy } from '@/lib/types';

/**
 * Fetches a policy document from Firestore by its slug using the Admin SDK.
 * @param slug The slug of the policy to fetch ('terms', 'privacy', 'refund').
 * @returns The policy data or null if not found.
 */
export async function getPolicyBySlug(slug: string): Promise<Policy | null> {
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
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
