/**
 * @fileoverview Firebase Admin SDK의 서버 전용 초기화 파일입니다.
 * 이 파일은 Cloud Functions 환경에서 단 한 번만 실행되어야 하는
 * Admin SDK 초기화 로직을 안전하게 캡슐화합니다.
 * 'firebase-admin' 모듈은 무겁지 않으므로 전역에서 한 번만 초기화하는 것이 효율적입니다.
 */
import * as admin from 'firebase-admin';

// admin.apps.length를 확인하여 중복 초기화를 방지합니다.
// Firebase 호스팅 환경에서는 자동으로 초기화될 수 있으므로 이 확인 과정은 필수입니다.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// 초기화된 admin 인스턴스를 내보냅니다.
// 이제 다른 함수 파일에서는 이 'admin' 객체를 가져와 바로 사용하면 됩니다.
export { admin };
