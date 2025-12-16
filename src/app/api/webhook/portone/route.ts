
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { Classification } from '@/lib/types';
import type { PortOnePayment, PortOneWebhookRequest } from '@/lib/portone';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK for Server-side usage
function initializeAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (!serviceAccountEnv) {
    throw new Error("FIREBASE_ADMIN_SDK_CONFIG is not set. Server-side features will fail.");
  }
  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG.", error);
    throw new Error("Firebase Admin SDK initialization failed.");
  }
}

// PortOne V2 API Access Token 발급 함수
async function getPortOneAccessToken(): Promise<string> {
  const apiSecret = process.env.PORTONE_V2_API_SECRET;
  if (!apiSecret) throw new Error("PORTONE_V2_API_SECRET is not defined.");
  
  const response = await fetch('https://api.portone.io/login/api-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiSecret }),
  });
  if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(`PortOne Access Token 발급 실패: ${errorBody.message}`);
  }
  const { accessToken } = await response.json();
  return accessToken;
}

// 결제 취소 함수
async function cancelPayment(paymentId: string, reason: string): Promise<void> {
  try {
      const accessToken = await getPortOneAccessToken();
      const response = await fetch(`https://api.portone.io/payments/${paymentId}/cancel`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
          const errorBody = await response.json();
          console.error(`[PAYMENT_CANCEL_FAILED] PaymentId: ${paymentId}, Reason: ${reason}, Error: ${JSON.stringify(errorBody)}`);
      } else {
          console.log(`[PAYMENT_CANCEL_SUCCESS] PaymentId: ${paymentId}, Reason: ${reason}`);
      }
  } catch (error) {
      console.error(`[PAYMENT_CANCEL_EXCEPTION] PaymentId: ${paymentId}`, error);
  }
}

async function verifyAndProcessPayment(paymentId: string): Promise<{ success: boolean, message: string }> {
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore();

  const paymentResponse = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `PortOne ${process.env.PORTONE_V2_API_SECRET}` } },
  );

  if (!paymentResponse.ok) {
      const errorBody = await paymentResponse.json();
      return { success: false, message: `결제내역 조회 실패: ${errorBody.message || '알 수 없는 오류'}` };
  }
  
  const paymentData: PortOnePayment = await paymentResponse.json();
  
  if (paymentData.status !== 'PAID') {
      return { success: false, message: `결제가 완료된 상태가 아닙니다. (상태: ${paymentData.status})` };
  }

  const userId = paymentData.customer?.id;
  const orderName = paymentData.orderName;

  if (!userId || !orderName) {
      await cancelPayment(paymentId, "사용자 또는 주문 정보 누락");
      return { success: false, message: '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.' };
  }
  
  const classificationName = orderName.split(' ')[0];
  const q = firestore.collection('classifications').where("name", "==", classificationName).limit(1);
  const classificationsSnapshot = await q.get();

  if (classificationsSnapshot.empty) {
       await cancelPayment(paymentId, "주문 상품을 찾을 수 없음");
       return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
  }
  
  const targetClassificationDoc = classificationsSnapshot.docs[0];
  const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
  
  // 30일 이용권 가격으로만 검증
  if (targetClassification.prices.day30 !== paymentData.amount.total) {
      await cancelPayment(paymentId, "결제 금액 불일치 자동 취소");
      return { success: false, message: `결제 금액 불일치. 주문 금액: ${targetClassification.prices.day30}, 실제 결제액: ${paymentData.amount.total}` };
  }

  const userRef = firestore.doc(`users/${userId}`);
  const subscriptionRef = userRef.collection('subscriptions').doc(targetClassification.id);

  // Check if this paymentId has already been processed
  const existingSub = await subscriptionRef.get();
  if (existingSub.exists && existingSub.data()?.paymentId === paymentId) {
      console.log(`[WEBHOOK_IGNORED] 이미 처리된 결제입니다. PaymentId: ${paymentId}`);
      return { success: true, message: '이미 처리된 결제입니다.' };
  }

  const purchasedAt = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(purchasedAt.toMillis() + 30 * 24 * 60 * 60 * 1000); // 30일

  const batch = firestore.batch();

  const newSubscriptionData = {
      userId: userId,
      classificationId: targetClassification.id,
      purchasedAt: purchasedAt,
      expiresAt: expiresAt,
      amount: paymentData.amount.total,
      orderName: paymentData.orderName,
      paymentId: paymentData.id,
      status: paymentData.status,
      method: paymentData.method?.name || 'UNKNOWN',
  };

  batch.set(subscriptionRef, newSubscriptionData, { merge: true });
  batch.update(userRef, {
      [`activeSubscriptions.${targetClassification.id}`]: {
          expiresAt: expiresAt,
          purchasedAt: purchasedAt
      }
  });
  
  await batch.commit();

  return { success: true, message: '결제가 성공적으로 처리되었습니다.' };
}

export async function POST(req: NextRequest) {
  try {
      const webhookData: PortOneWebhookRequest = await req.json();
      const { id: paymentId, status } = webhookData;

      if (!paymentId) {
          return NextResponse.json({ success: false, message: 'paymentId가 없습니다.' }, { status: 400 });
      }

      if (status === 'PAID') {
          console.log(`[WEBHOOK_RECEIVED] PAID for paymentId: ${paymentId}`);
          const result = await verifyAndProcessPayment(paymentId);
          if (result.success) {
              return NextResponse.json({ success: true });
          } else {
              // Log the failure but return a 200 to PortOne to prevent retries for business logic failures.
              console.error(`[WEBHOOK_PROCESS_FAILED] paymentId: ${paymentId}, message: ${result.message}`);
              return NextResponse.json({ success: false, message: result.message }, { status: 200 });
          }
      } else {
          console.log(`[WEBHOOK_RECEIVED] Status: ${status} for paymentId: ${paymentId}. Ignoring.`);
          // Acknowledge receipt of non-PAID events to stop PortOne from retrying.
          return NextResponse.json({ success: true, message: `Webhook for status '${status}' received and acknowledged.` });
      }

  } catch (e: any) {
      console.error('웹훅 처리 중 심각한 오류 발생 (POST):', e);
      // Return 500 for unexpected server errors, so PortOne might retry.
      return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 서버 오류 발생' }, { status: 500 });
  }
}
