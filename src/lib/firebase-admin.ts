import 'server-only';
import * as admin from 'firebase-admin';
import { App, getApps } from 'firebase-admin/app';
import { config } from 'dotenv';

// .env 파일에서 환경 변수를 로드합니다.
config();

/**
 * Initializes the Firebase Admin SDK, ensuring it's a singleton.
 * This function is safe to call from any server-side module.
 *
 * It uses the `SERVICE_ACCOUNT_JSON` environment variable for explicit credential configuration.
 *
 * @returns The initialized Firebase Admin App instance.
 * @throws {Error} If initialization fails because the required environment variable is missing or invalid.
 */
export function initializeAdminApp(): App {
  // 앱이 이미 초기화되었다면, 기존 인스턴스를 반환합니다.
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountString = process.env.SERVICE_ACCOUNT_JSON;

  if (!serviceAccountString) {
    console.error("FATAL: SERVICE_ACCOUNT_JSON environment variable is not set.");
    throw new Error(
      'Firebase Admin SDK initialization failed. ' +
      'The SERVICE_ACCOUNT_JSON environment variable is missing. ' +
      'Please ensure it is set correctly in your .env file.'
    );
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountString);
    
    // 서비스 계정 정보를 사용하여 앱을 초기화합니다.
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("Firebase Admin SDK initialized successfully via service account.");
    return getApps()[0];

  } catch (parseError: any) {
    console.error("Failed to parse SERVICE_ACCOUNT_JSON. Make sure it's a valid JSON string (and not a file path).", parseError);
    throw new Error("Firebase Admin SDK initialization failed due to invalid configuration in SERVICE_ACCOUNT_JSON.");
  }
}
