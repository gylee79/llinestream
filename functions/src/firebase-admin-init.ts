/**
 * @fileoverview Firebase Admin SDK의 서버 전용 초기화 파일입니다.
 * 이 모듈은 admin SDK를 가져오지만, 부수 효과(side-effect)로 자동 초기화를 수행하지 않습니다.
 * 초기화는 반드시 함수 핸들러 내에서 지연(lazy) 방식으로 수행되어야 합니다.
 */
import * as admin from 'firebase-admin';

// admin.initializeApp()을 여기서 호출하지 않습니다.
// 초기화되지 않은 admin 객체를 내보내어, 호출하는 쪽에서 초기화 시점을 제어하도록 합니다.
export { admin };
