
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { Classification } from '@/lib/types';
import * as admin from 'firebase-admin';
import * as PortOne from "@portone/server-sdk";

// The 'force-dynamic' option ensures that the request body is not pre-parsed.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    if (!adminApp) {
        return { success: false, message: 'Firebase Admin SDK 초기화에 실패했습니다.' };
    }
    const firestore = admin.firestore();

    const portone = new PortOne.PortOneClient({ apiSecret: process.env.PORTONE_V2_API_SECRET! });
    const paymentResponse = await portone.payment.getPayment({ paymentId });

    if (!paymentResponse) {
        console.error(`[DEBUG] 3b. [PROCESS_FAILED] PortOne GetPayment API returned null for paymentId: ${paymentId}`);
        return { success: false, message: `결제내역 조회 실패: paymentId ${paymentId}에 해당하는 내역이 없습니다.` };
    }
    console.log(`[DEBUG] 3b. PortOne GetPayment API successful. Status: ${paymentResponse.status}`);

    const paymentData: PortOne.Payment = paymentResponse;

    if (paymentData.status !== 'PAID') {
        console.log(`[DEBUG] 3c. [PROCESS_IGNORED] Payment status is not 'PAID'. Current status: ${paymentData.status}`);
        return { success: true, message: `결제 상태가 PAID가 아니므로 처리를 건너뜁니다: ${paymentData.status}` };
    }

    const userId = paymentData.customer?.id;
    const orderName = paymentData.orderName;

    if (!userId || !orderName) {
        console.error(`[DEBUG] 3d. [PROCESS_FAILED] Missing userId or orderName. Cancelling payment.`);
        // await cancelPayment(paymentId, "사용자 또는 주문 정보 누락"); // 임시 비활성화
        return { success: false, message: '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.' };
    }
    
    // 이 예제에서는 주문명에서 첫 번째 상품 이름과 기간을 파싱한다고 가정합니다.
    const orderItems = orderName.split(' 외 ')[0]; 
    const nameParts = orderItems.split(' ');
    const classificationName = nameParts.slice(0, -2).join(' '); // "코딩 30일 이용권" -> "코딩"
    const durationLabel = nameParts.slice(-2).join(' '); // "30일 이용권"
    console.log(`[DEBUG] 3d. Parsed classificationName: ${classificationName}, durationLabel: ${durationLabel}`);

    const durationMap: { [key: string]: number } = { "1일 이용권": 1, "30일 이용권": 30, "60일 이용권": 60, "90일 이용권": 90 };
    const durationDays = durationMap[durationLabel] || 30; // 기본값 30일

    const q = firestore.collection('classifications').where("name", "==", classificationName).limit(1);
    const classificationsSnapshot = await q.get();

    if (classificationsSnapshot.empty) {
        console.error(`[DEBUG] 3e. [PROCESS_FAILED] Classification not found in DB: ${classificationName}. Cancelling payment.`);
        // await cancelPayment(paymentId, "주문 상품을 찾을 수 없음"); // 임시 비활성화
        return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
    }
    
    const targetClassificationDoc = classificationsSnapshot.docs[0];
    const targetClassificationId = targetClassificationDoc.id;
    console.log(`[DEBUG] 3e. Found classification in DB: ${targetClassificationId}`);
    
    const userRef = firestore.doc(`users/${userId}`);
    // 구독 정보는 이제 paymentId로 저장하여 고유성을 보장합니다.
    const subscriptionRef = userRef.collection('subscriptions').doc(paymentId);

    try {
        await firestore.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const subDoc = await transaction.get(subscriptionRef);

            if (subDoc.exists) {
                console.log(`[DEBUG] 3f. [PROCESS_IGNORED] This paymentId has already been processed. paymentId: ${paymentId}`);
                return; // 트랜잭션 종료
            }

            if (!userDoc.exists) {
                throw new Error(`User with ID ${userId} not found.`);
            }
            
            const purchasedAt = Timestamp.now();
            const expiresAt = Timestamp.fromMillis(purchasedAt.toMillis() + durationDays * 24 * 60 * 60 * 1000);

            const newSubscriptionData = {
                userId: userId,
                classificationId: targetClassificationId,
                purchasedAt,
                expiresAt,
                amount: paymentData.amount.total,
                orderName: paymentData.orderName,
                paymentId: paymentData.id,
                status: paymentData.status,
                method: paymentData.method?.name || 'UNKNOWN',
            };

            transaction.set(subscriptionRef, newSubscriptionData);
            
            // 사용자의 활성 구독 정보 업데이트
            const currentUserData = userDoc.data() || {};
            const existingSubscriptions = currentUserData.activeSubscriptions || {};

            transaction.update(userRef, {
                activeSubscriptions: {
                  ...existingSubscriptions,
                  [targetClassificationId]: {
                    expiresAt: expiresAt,
                    purchasedAt: purchasedAt
                  }
                }
            });
        });

        console.log(`[DEBUG] 3g. [PROCESS_SUCCESS] Successfully committed subscription to DB for user ${userId}.`);
        return { success: true, message: '결제가 성공적으로 처리되었습니다.' };

    } catch (error) {
        console.error(`[FATAL_DB_ERROR] Firestore transaction failed for user ${userId}. Payment NOT cancelled automatically. Please check manually. PaymentId: ${paymentId}`, error);
        // await cancelPayment(paymentId, "서버 내부 데이터 처리 실패"); // 임시 비활성화
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 서버 오류";
        return { success: false, message: `데이터베이스 처리 실패: ${errorMessage}` };
    }
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
      
      const webhook = await PortOne.Webhook.verify(req.headers, rawBody, webhookSecret);
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
                  // 실패하더라도 200을 응답해야 포트원에서 재전송을 멈춥니다.
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
        // 검증 실패 시 400 오류를 반환합니다.
        return NextResponse.json({ success: false, message: '웹훅 검증에 실패했습니다.' }, { status: 400 });
      }
      
      console.error('[DEBUG] 5. [UNHANDLED_ERROR] Unhandled error during webhook processing:', e);
      return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 서버 오류 발생' }, { status: 500 });
  }
}

    