
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
  const adminApp = initializeAdminApp();
  const firestore = admin.firestore();
  
  // 1. 포트원 서버 API로 결제 내역 직접 조회 (교차 검증)
  const portone = new PortOne.PortOneClient({ apiSecret: process.env.PORTONE_V2_API_SECRET! });
  const paymentResponse = await portone.payment.getPayment({ paymentId });

  if (!paymentResponse) {
      return { success: false, message: `결제내역 조회 실패: paymentId ${paymentId}에 해당하는 내역이 없습니다.` };
  }
  
  const paymentData: PortOne.Payment = paymentResponse;
  
  // 2. 결제 상태 확인
  if (paymentData.status !== 'PAID') {
      console.log(`[WEBHOOK_IGNORED] 결제가 완료된 상태가 아닙니다. (상태: ${paymentData.status})`);
      // PAID 상태가 아니면 성공으로 응답하여 포트원이 재전송하지 않도록 함
      return { success: true, message: `결제 상태가 PAID가 아니므로 처리를 건너뜁니다: ${paymentData.status}` };
  }

  const userId = paymentData.customer?.id;
  const orderName = paymentData.orderName;

  if (!userId || !orderName) {
      await cancelPayment(paymentId, "사용자 또는 주문 정보 누락");
      return { success: false, message: '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.' };
  }
  
  // 3. 주문 정보 파싱 및 상품 조회
  const orderItems = orderName.split(' 외 ')[0]; // "A상품 외 2건" -> "A상품"
  const classificationName = orderItems.split(' ')[0]; // "코딩 30일 이용권" -> "코딩"

  const q = firestore.collection('classifications').where("name", "==", classificationName).limit(1);
  const classificationsSnapshot = await q.get();

  if (classificationsSnapshot.empty) {
       await cancelPayment(paymentId, "주문 상품을 찾을 수 없음");
       return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
  }
  
  const targetClassificationDoc = classificationsSnapshot.docs[0];
  const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
  
  const orderPrice = paymentData.amount.total;
  
  // TODO: 실제 서비스에서는 주문 생성 시 DB에 저장된 주문 금액과 paymentData.amount.total을 비교하는 로직이 필요합니다.
  // 여기서는 예시로 해당 로직은 생략합니다.

  const userRef = firestore.doc(`users/${userId}`);
  // 구독 정보는 classificationId를 문서 ID로 사용하여 중복 구독을 방지합니다.
  const subscriptionRef = userRef.collection('subscriptions').doc(targetClassification.id);

  // 4. 이미 처리된 결제인지 확인 (멱등성 확보)
  const existingSub = await subscriptionRef.get();
  if (existingSub.exists && existingSub.data()?.paymentId === paymentId) {
      console.log(`[WEBHOOK_IGNORED] 이미 처리된 결제입니다. PaymentId: ${paymentId}`);
      return { success: true, message: '이미 처리된 결제입니다.' };
  }

  // 5. DB에 구독 정보 저장
  const purchasedAt = Timestamp.now();
  
  // TODO: 이용권 기간을 주문명에서 파싱하거나, customData를 사용하여 더 정확하게 설정해야 합니다.
  // 여기서는 예시로 30일로 고정합니다.
  const DURATION_DAYS = 30;
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

  // 구독 정보 저장 (기존 구독이 있다면 덮어씁니다)
  batch.set(subscriptionRef, newSubscriptionData, { merge: true });
  // 사용자 문서에 활성화된 구독 정보 업데이트 (비정규화)
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
      const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("[WEBHOOK_ERROR] PORTONE_WEBHOOK_SECRET이 설정되지 않았습니다.");
        return NextResponse.json({ success: false, message: '서버 설정 오류: 웹훅 시크릿이 누락되었습니다.' }, { status: 500 });
      }

      // 1. 웹훅 시그니처 검증을 위해 raw body 텍스트를 가져옵니다.
      const rawBody = await req.text();
      
      // 2. 웹훅 메시지를 검증합니다. 실패 시 WebhookVerificationError 발생.
      const webhook = await PortOne.Webhook.verify(webhookSecret, rawBody, req.headers);

      // 3. 결제 이벤트인 경우에만 비즈니스 로직을 처리합니다.
      if ("paymentId" in webhook.data) {
          console.log(`[WEBHOOK_RECEIVED] Status: ${webhook.status}, PaymentId: ${webhook.data.paymentId}`);
          
          // 4. 결제 상태가 'PAID'인 경우에만 DB 처리를 진행합니다.
          if (webhook.status === 'PAID') {
              const result = await verifyAndProcessPayment(webhook.data.paymentId);
              
              if (result.success) {
                  // 성공적으로 처리되었으므로 포트원에 200 OK 응답을 보냅니다.
                  return NextResponse.json({ success: true });
              } else {
                  // 비즈니스 로직 실패(예: 상품 없음)의 경우, 재시도를 막기 위해 200 OK를 응답하되, 에러는 기록합니다.
                  console.error(`[WEBHOOK_PROCESS_FAILED] paymentId: ${webhook.data.paymentId}, message: ${result.message}`);
                  return NextResponse.json({ success: false, message: result.message }, { status: 200 });
              }
          } else {
              // 'PAID'가 아닌 다른 상태(CANCELED 등)는 일단 무시하고 200 OK를 보냅니다.
              return NextResponse.json({ success: true, message: `Status '${webhook.status}' event acknowledged.` });
          }
      } else {
          // 결제 이벤트가 아닌 경우(예: 스토어 리뷰)도 200 OK를 보내 무시합니다.
          return NextResponse.json({ success: true, message: 'Non-payment event acknowledged.' });
      }

  } catch (e: any) {
      if (e instanceof PortOne.Webhook.WebhookVerificationError) {
        // 5. 웹훅 검증 실패 시, 400 Bad Request 응답을 보냅니다.
        console.error('웹훅 검증 실패:', e);
        return NextResponse.json({ success: false, message: '웹훅 검증에 실패했습니다.' }, { status: 400 });
      }
      
      // 6. 그 외 예측하지 못한 서버 오류 발생 시, 포트원이 재시도할 수 있도록 500 에러를 응답합니다.
      console.error('웹훅 처리 중 심각한 오류 발생:', e);
      return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 서버 오류 발생' }, { status: 500 });
  }
}

    