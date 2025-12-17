
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { Classification } from '@/lib/types';
import * as admin from 'firebase-admin';
import * as PortOne from "@portone/server-sdk";

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

// PortOne V2 API Access Token 발급 함수 (취소 로직용)
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
      const response = await fetch(`https://api.portone.io/v2/payments/${paymentId}/cancel`, {
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
  console.log(`[DEBUG] 3a. Starting verifyAndProcessPayment for paymentId: ${paymentId}`);
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore();
  
  // 1. 포트원 서버 API로 결제 내역 직접 조회 (교차 검증)
  const portone = new PortOne.PortOneClient({ apiSecret: process.env.PORTONE_V2_API_SECRET! });
  const paymentResponse = await portone.payment.getPayment({ paymentId });

  if (!paymentResponse) {
      console.error(`[DEBUG] 3b. [PROCESS_FAILED] PortOne GetPayment API returned null for paymentId: ${paymentId}`);
      return { success: false, message: `결제내역 조회 실패: paymentId ${paymentId}에 해당하는 내역이 없습니다.` };
  }
  console.log(`[DEBUG] 3b. PortOne GetPayment API successful. Status: ${paymentResponse.status}`);
  
  const paymentData: PortOne.Payment = paymentResponse;
  
  // 2. 결제 상태 확인
  if (paymentData.status !== 'PAID') {
      console.log(`[DEBUG] 3c. [PROCESS_IGNORED] Payment status is not 'PAID'. Current status: ${paymentData.status}`);
      return { success: true, message: `결제 상태가 PAID가 아니므로 처리를 건너뜁니다: ${paymentData.status}` };
  }

  const userId = paymentData.customer?.id;
  const orderName = paymentData.orderName;

  if (!userId || !orderName) {
      console.error(`[DEBUG] 3d. [PROCESS_FAILED] Missing userId or orderName. Cancelling payment.`);
      await cancelPayment(paymentId, "사용자 또는 주문 정보 누락");
      return { success: false, message: '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.' };
  }
  
  // 3. 주문 정보 파싱 및 상품 조회
  const orderItems = orderName.split(' 외 ')[0]; // "A상품 외 2건" -> "A상품"
  const classificationName = orderItems.split(' ')[0]; // "코딩 30일 이용권" -> "코딩"
  console.log(`[DEBUG] 3d. Parsed classificationName: ${classificationName}`);

  const q = firestore.collection('classifications').where("name", "==", classificationName).limit(1);
  const classificationsSnapshot = await q.get();

  if (classificationsSnapshot.empty) {
       console.error(`[DEBUG] 3e. [PROCESS_FAILED] Classification not found in DB: ${classificationName}. Cancelling payment.`);
       await cancelPayment(paymentId, "주문 상품을 찾을 수 없음");
       return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
  }
  
  const targetClassificationDoc = classificationsSnapshot.docs[0];
  const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
  console.log(`[DEBUG] 3e. Found classification in DB: ${targetClassification.id}`);
  
  const orderPrice = paymentData.amount.total;
  
  const userRef = firestore.doc(`users/${userId}`);
  const subscriptionRef = userRef.collection('subscriptions').doc(targetClassification.id);

  // 4. 이미 처리된 결제인지 확인 (멱등성 확보)
  const existingSub = await subscriptionRef.get();
  if (existingSub.exists && existingSub.data()?.paymentId === paymentId) {
      console.log(`[DEBUG] 3f. [PROCESS_IGNORED] This paymentId has already been processed. paymentId: ${paymentId}`);
      return { success: true, message: '이미 처리된 결제입니다.' };
  }

  // 5. DB에 구독 정보 저장
  const purchasedAt = Timestamp.now();
  const DURATION_DAYS = 30; // 예시로 30일 고정
  const expiresAt = Timestamp.fromMillis(purchasedAt.toMillis() + DURATION_DAYS * 24 * 60 * 60 * 1000);

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
  console.log(`[DEBUG] 3g. [PROCESS_SUCCESS] Successfully committed subscription to DB for user ${userId}.`);

  return { success: true, message: '결제가 성공적으로 처리되었습니다.' };
}

export async function POST(req: NextRequest) {
  console.log('---');
  console.log(`[DEBUG] 1. Webhook endpoint /api/webhook/portone was hit at ${new Date().toISOString()}`);
  try {
      const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("[DEBUG] 1a. [FATAL] PORTONE_WEBHOOK_SECRET is not set in environment variables.");
        return NextResponse.json({ success: false, message: '서버 설정 오류: 웹훅 시크릿이 누락되었습니다.' }, { status: 500 });
      }

      const rawBody = await req.text();
      console.log('[DEBUG] 1b. Received Raw Body:', rawBody.substring(0, 500) + '...');
      
      const webhook = await PortOne.Webhook.verify(webhookSecret, rawBody, req.headers);
      console.log('[DEBUG] 2. Webhook verification successful. Event ID:', webhook.id);

      if ("paymentId" in webhook.data) {
          console.log(`[DEBUG] 2a. Event is a payment event. Status: ${webhook.status}, PaymentId: ${webhook.data.paymentId}`);
          
          if (webhook.status === 'PAID') {
              console.log(`[DEBUG] 3. Status is 'PAID'. Proceeding to process payment.`);
              const result = await verifyAndProcessPayment(webhook.data.paymentId);
              
              if (result.success) {
                  console.log(`[DEBUG] 4. [SUCCESS_RESPONSE] Processed successfully. Responding 200 OK.`);
                  return NextResponse.json({ success: true, message: result.message });
              } else {
                  console.error(`[DEBUG] 4a. [ERROR_RESPONSE] Business logic failed: ${result.message}. Responding 200 OK to prevent retry.`);
                  return NextResponse.json({ success: false, message: result.message }, { status: 200 });
              }
          } else {
              console.log(`[DEBUG] 3. [IGNORED_RESPONSE] Status is '${webhook.status}', not 'PAID'. Acknowledging with 200 OK.`);
              return NextResponse.json({ success: true, message: `Status '${webhook.status}' event acknowledged.` });
          }
      } else {
          console.log(`[DEBUG] 2a. [IGNORED_RESPONSE] Non-payment event received. Acknowledging with 200 OK.`);
          return NextResponse.json({ success: true, message: 'Non-payment event acknowledged.' });
      }

  } catch (e: any) {
      if (e instanceof PortOne.Webhook.WebhookVerificationError) {
        console.error('[DEBUG] 2. [VERIFICATION_FAILED] Webhook verification failed:', e.message);
        return NextResponse.json({ success: false, message: '웹훅 검증에 실패했습니다.' }, { status: 400 });
      }
      
      console.error('[DEBUG] 5. [UNHANDLED_ERROR] Unhandled error during webhook processing:', e);
      return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 서버 오류 발생' }, { status: 500 });
  }
}
