
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { Classification } from '@/lib/types';
import * as admin from 'firebase-admin';
import * as PortOne from "@portone/server-sdk";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    const portone = PortOne.PortOneClient({ secret: process.env.PORTONE_V2_API_SECRET! });
    const paymentResponse = await portone.payment.getPayment({ paymentId });

    if (!paymentResponse) {
        console.error(`[DEBUG] 3b. [PROCESS_FAILED] PortOne GetPayment API returned null for paymentId: ${paymentId}`);
        return { success: false, message: `결제내역 조회 실패: paymentId ${paymentId}에 해당하는 내역이 없습니다.` };
    }
    
    if (paymentResponse.status !== 'PAID') {
        console.log(`[DEBUG] 3b. [PROCESS_IGNORED] Payment status is not 'PAID'. Current status: ${String(paymentResponse.status)}`);
        return { success: true, message: `결제 상태가 PAID가 아니므로 처리를 건너뜁니다: ${String(paymentResponse.status)}` };
    }
    
    const paymentData: PortOne.Payment.PaidPayment = paymentResponse;
    console.log(`[DEBUG] 3b. PortOne GetPayment API successful. Status: ${String(paymentData.status)}`);

    const userId = paymentData.customer?.id;
    const orderName = paymentData.orderName;

    if (!userId || !orderName) {
        console.error(`[DEBUG] 3d. [PROCESS_FAILED] Missing userId or orderName. Cancelling payment.`);
        await cancelPayment(paymentData.id, '사용자 또는 주문 정보 누락');
        return { success: false, message: '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.' };
    }
    
    const orderItems = orderName.split(' 외 ')[0]; 
    const nameParts = orderItems.split(' ');
    const classificationName = nameParts.slice(0, -2).join(' ');
    const durationLabel = nameParts.slice(-2).join(' ');
    console.log(`[DEBUG] 3d. Parsed classificationName: ${classificationName}, durationLabel: ${durationLabel}`);

    const durationMap: { [key: string]: number } = { "1일 이용권": 1, "30일 이용권": 30, "60일 이용권": 60, "90일 이용권": 90 };
    const durationDays = durationMap[durationLabel] || 30;

    const q = firestore.collection('classifications').where("name", "==", classificationName).limit(1);
    const classificationsSnapshot = await q.get();

    if (classificationsSnapshot.empty) {
        console.error(`[DEBUG] 3e. [PROCESS_FAILED] Classification not found in DB: ${classificationName}. Cancelling payment.`);
        await cancelPayment(paymentData.id, `상품(${classificationName})을 찾을 수 없음`);
        return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
    }
    
    const targetClassificationDoc = classificationsSnapshot.docs[0];
    const targetClassificationId = targetClassificationDoc.id;
    console.log(`[DEBUG] 3e. Found classification in DB: ${targetClassificationId}`);
    
    const userRef = firestore.doc(`users/${userId}`);
    const subscriptionRef = userRef.collection('subscriptions').doc(paymentData.id);

    try {
        await firestore.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const subDoc = await transaction.get(subscriptionRef);

            if (subDoc.exists) {
                console.log(`[DEBUG] 3f. [PROCESS_IGNORED] This paymentId has already been processed. paymentId: ${paymentData.id}`);
                return;
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
                status: String(paymentData.status),
                method: paymentData.channel.pgProvider || 'UNKNOWN',
            };

            transaction.set(subscriptionRef, newSubscriptionData);
            
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
        console.error(`[FATAL_DB_ERROR] Firestore transaction failed for user ${userId}. Please check manually. PaymentId: ${paymentData.id}`, error);
        const errorMessage = error instanceof Error ? error.message : "알 수 없는 서버 오류";
        // NOTE: Temporarily disabling auto-cancellation for debugging purposes.
        // await cancelPayment(paymentData.id, `데이터베이스 처리 실패: ${errorMessage}`);
        console.error(`[PAYMENT_NOT_CANCELLED] Payment for ${paymentData.id} was NOT automatically cancelled due to DB error. Please check manually.`);
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
      const headersObject: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headersObject[key] = value;
      });
      
      console.log('[DEBUG] 1b. Received Raw Body:', rawBody.substring(0, 500) + '...');
      
      const webhook = await PortOne.Webhook.verify(webhookSecret, rawBody, headersObject);

      console.log('[DEBUG] 2. Webhook verification successful.');

      if ('payment' in webhook) {
          const payment: any = webhook.payment;
          console.log(`[DEBUG] 2a. Event is a payment event. Status: ${payment.status}, PaymentId: ${payment.id}`);
          
          if (payment.status === 'PAID') {
              console.log(`[DEBUG] 3. Status is 'PAID'. Proceeding to process payment.`);
              const result = await verifyAndProcessPayment(payment.id);
              
              if (result.success) {
                  console.log(`[DEBUG] 4. [SUCCESS_RESPONSE] Processed successfully. Responding 200 OK.`);
                  return NextResponse.json({ success: true, message: result.message });
              } else {
                  console.error(`[DEBUG] 4a. [ERROR_RESPONSE] Business logic failed: ${result.message}. Responding 200 OK to prevent retry.`);
                  return NextResponse.json({ success: false, message: result.message }, { status: 200 });
              }
          } else {
              console.log(`[DEBUG] 3. [IGNORED_RESPONSE] Status is '${String(payment.status)}', not 'PAID'. Acknowledging with 200 OK.`);
              return NextResponse.json({ success: true, message: `Status '${String(payment.status)}' event acknowledged.` });
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
