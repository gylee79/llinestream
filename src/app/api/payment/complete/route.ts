
import { NextRequest, NextResponse } from 'next/server';
import { doc, getDocs, updateDoc, Timestamp, collection, where, query, limit, writeBatch } from 'firebase/firestore';
import type { Classification, Subscription } from '@/lib/types';
import type { PortOnePayment, PortOneWebhookRequest } from '@/lib/portone';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK for Server-side usage
function initializeAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (!serviceAccountEnv || serviceAccountEnv === '여기에_json_붙여넣기') {
    console.error("FIREBASE_ADMIN_SDK_CONFIG is not set or is a placeholder. Server-side features will fail.");
    // In a real scenario, you might want to throw an error, but here we'll let it fail later
    // to avoid crashing the server on startup if the env var is missing.
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
     return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
     console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG. Make sure it's a valid JSON string.", error);
     return null;
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

async function verifyAndProcessPayment(paymentId: string): Promise<{ success: boolean, message: string, classificationName?: string }> {
    const adminApp = initializeAdminApp();
    if (!adminApp) return { success: false, message: '서버 설정 오류: Firebase Admin SDK 초기화 실패' };
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
    const q = query(collection(firestore, 'classifications'), where("name", "==", classificationName), limit(1));
    const classificationsSnapshot = await getDocs(q as any);

    if (classificationsSnapshot.empty) {
         await cancelPayment(paymentId, "주문 상품을 찾을 수 없음");
         return { success: false, message: `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.` };
    }
    
    const targetClassificationDoc = classificationsSnapshot.docs[0];
    const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
    
    if (targetClassification.prices.day30 !== paymentData.amount.total) {
        await cancelPayment(paymentId, "결제 금액 불일치 자동 취소");
        return { success: false, message: `결제 금액 불일치. 주문 금액: ${targetClassification.prices.day30}, 실제 결제액: ${paymentData.amount.total}` };
    }

    const userRef = doc(firestore, 'users', userId);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30일 이용권
    
    const subscriptionRef = doc(collection(userRef, 'subscriptions'), targetClassification.id);

    const batch = firestore.batch();

    const newSubscription: Omit<Subscription, 'id'> = {
        userId: userId,
        classificationId: targetClassification.id,
        purchasedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expiresAt),
        amount: paymentData.amount.total,
        orderName: paymentData.orderName,
        paymentId: paymentData.id,
        status: paymentData.status,
        method: paymentData.method?.name || 'UNKNOWN',
    };

    batch.set(subscriptionRef, newSubscription, { merge: true });
    batch.update(userRef, {
        [`activeSubscriptions.${targetClassification.id}`]: {
            expiresAt: Timestamp.fromDate(expiresAt),
            purchasedAt: Timestamp.now()
        }
    });
    
    await batch.commit();

    return { success: true, message: '결제가 성공적으로 처리되었습니다.', classificationName };
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const paymentId = searchParams.get('paymentId');
    const code = searchParams.get('code');
    const message = searchParams.get('message');

    if (code || !paymentId) {
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', message || '결제에 실패했거나 ID가 없습니다.');
        return NextResponse.redirect(failureUrl);
    }

    try {
        const result = await verifyAndProcessPayment(paymentId);
        
        if (result.success) {
            const successUrl = new URL('/contents', req.url);
            successUrl.searchParams.set('payment_success', 'true');
            successUrl.searchParams.set('classification_name', result.classificationName || '');
            return NextResponse.redirect(successUrl);
        } else {
            throw new Error(result.message);
        }

    } catch (e: any) {
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', e.message || '결제 처리 중 오류가 발생했습니다.');
        return NextResponse.redirect(failureUrl);
    }
}

export async function POST(req: NextRequest) {
    try {
        const webhookData: PortOneWebhookRequest = await req.json();
        const { paymentId, status } = webhookData;

        if (!paymentId) {
            return NextResponse.json({ success: false, message: 'paymentId가 없습니다.' }, { status: 400 });
        }

        if (status === 'PAID') {
            const result = await verifyAndProcessPayment(paymentId);
            if (result.success) {
                return NextResponse.json({ success: true });
            } else {
                return NextResponse.json({ success: false, message: result.message }, { status: 500 });
            }
        } else {
            console.log(`[WEBHOOK_RECEIVED] Non-PAID status: ${status} for paymentId: ${paymentId}`);
            return NextResponse.json({ success: true, message: `Webhook for status '${status}' received.` });
        }

    } catch (e: any) {
        console.error('웹훅 처리 중 오류 발생 (POST):', e);
        return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 오류 발생' }, { status: 500 });
    }
}

    