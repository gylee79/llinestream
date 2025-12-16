
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
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG as string);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// --- 1. 핵심 검증 로직을 별도 함수로 분리 ---
async function verifyAndProcessPayment(paymentId: string): Promise<{ success: boolean, message: string, classificationName?: string }> {
    const firestore = admin.firestore();

    // 1-1. 포트원 결제내역 단건조회 API 호출
    const paymentResponse = await fetch(
        `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
        { headers: { Authorization: `PortOne ${process.env.PORTONE_V2_API_SECRET}` } },
    );

    if (!paymentResponse.ok) {
        const errorBody = await paymentResponse.json();
        const errorMessage = `결제내역 조회 실패: ${errorBody.message || '알 수 없는 오류'}`;
        console.error(`[PAYMENT_VERIFICATION_ERROR] ${errorMessage}`, errorBody);
        return { success: false, message: errorMessage };
    }
    
    const paymentData: PortOnePayment = await paymentResponse.json();
    
    // 1-2. 실제 결제 상태 및 금액 검증
    if (paymentData.status !== 'PAID') {
        const message = `결제가 완료되지 않았습니다. (상태: ${paymentData.status})`;
        // 가상계좌 발급 등은 PAID 상태가 아니므로 로그만 남기고 일단 성공 처리할 수 있음 (여기서는 에러로 처리)
        console.warn(`[PAYMENT_NOT_PAID] ${message}`, paymentData);
        return { success: false, message };
    }

    const userId = paymentData.customer?.id;
    const orderName = paymentData.orderName;

    if (!userId || !orderName) {
        const message = '사용자 또는 주문 정보가 없어 결제 처리가 불가능합니다.';
        console.error(`[PAYMENT_MISSING_INFO] ${message}`, paymentData);
        return { success: false, message };
    }
    
    // 1-3. DB에서 상품(Classification) 정보 조회 및 금액 비교 (위변조 검증)
    const classificationName = orderName.split(' ')[0];
    const q = query(collection(firestore, 'classifications'), where("name", "==", classificationName), limit(1));
    const classificationsSnapshot = await getDocs(q as any);

    if (classificationsSnapshot.empty) {
         const message = `주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.`;
         console.error(`[PAYMENT_PRODUCT_NOT_FOUND] ${message}`, paymentData);
         return { success: false, message };
    }
    
    const targetClassificationDoc = classificationsSnapshot.docs[0];
    const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
    
    if (targetClassification.prices.day30 !== paymentData.amount.total) {
        const message = `결제 금액 불일치. 주문 금액: ${targetClassification.prices.day30}, 실제 결제액: ${paymentData.amount.total}`;
        console.error(`[PAYMENT_AMOUNT_MISMATCH] ${message}`, paymentData);
        // TODO: 실제 환경에서는 여기서 결제 취소 API를 호출해야 합니다.
        return { success: false, message };
    }

    // 1-4. 모든 검증 통과, 사용자에게 이용권 부여
    const userRef = doc(firestore, 'users', userId);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30일 이용권
    
    // 구독 정보는 classificationId를 문서 ID로 사용하여 덮어쓴다 (중복 방지)
    const subscriptionRef = doc(collection(userRef, 'subscriptions'), targetClassification.id);

    const batch = firestore.batch();

    const newSubscription: Omit<Subscription, 'id'> = {
        userId: userId,
        classificationId: targetClassification.id,
        purchasedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expiresAt),
    };

    // 구독 정보 생성 또는 업데이트
    batch.set(subscriptionRef, newSubscription);

    // 사용자 문서에 활성화된 구독 정보 업데이트 (denormalization)
    batch.update(userRef, {
        [`activeSubscriptions.${targetClassification.id}`]: {
            expiresAt: Timestamp.fromDate(expiresAt),
            purchasedAt: Timestamp.now()
        }
    });
    
    await batch.commit();

    return { success: true, message: '결제가 성공적으로 처리되었습니다.', classificationName };
}

// --- 2. GET 요청 핸들러 (사용자 리다이렉트) ---
export async function GET(req: NextRequest) {
    initializeAdminApp();
    const { searchParams } = new URL(req.url);
    const paymentId = searchParams.get('paymentId');
    const code = searchParams.get('code');
    const message = searchParams.get('message');
    const pgMessage = searchParams.get('pg_message');

    // 사용자가 중간에 취소했거나 PG사 오류
    if (code) {
        console.error(`[PAYMENT_REDIRECT_FAILURE] ${message} (PG: ${pgMessage})`);
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', message || '결제에 실패했습니다.');
        return NextResponse.redirect(failureUrl);
    }
    
    if (!paymentId) {
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', '결제 ID가 없습니다.');
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
        console.error('결제 검증 및 처리 실패 (GET):', e.message);
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', e.message || '결제 처리 중 오류가 발생했습니다.');
        return NextResponse.redirect(failureUrl);
    }
}


// --- 3. POST 요청 핸들러 (포트원 웹훅) ---
export async function POST(req: NextRequest) {
    initializeAdminApp();
    
    try {
        const webhookData: PortOneWebhookRequest = await req.json();
        const { paymentId, status } = webhookData;

        if (!paymentId) {
            return NextResponse.json({ success: false, message: 'paymentId가 없습니다.' }, { status: 400 });
        }

        // 결제가 성공적으로 완료된 경우에만 검증 로직 실행
        if (status === 'PAID') {
            const result = await verifyAndProcessPayment(paymentId);

            if (result.success) {
                // 웹훅 성공 시, 포트원 서버에 성공했다고 알려줘야 함
                return NextResponse.json({ success: true, message: result.message });
            } else {
                // 검증 실패 시, 포트원 서버에 오류를 알려 재시도를 유도할 수 있음
                return NextResponse.json({ success: false, message: result.message }, { status: 500 });
            }
        } else {
            // PAID 상태가 아닌 웹훅 (e.g., VIRTUAL_ACCOUNT_ISSUED, FAILED, CANCELLED)
            // 필요에 따라 로직 추가 (예: 가상계좌 발급 시 사용자에게 알림 등)
            console.log(`[WEBHOOK_RECEIVED] Non-PAID status received: ${status} for paymentId: ${paymentId}`);
            // 포트원에게 정상적으로 수신했다고 알림
            return NextResponse.json({ success: true, message: `Webhook for status '${status}' received.` });
        }

    } catch (e: any) {
        console.error('웹훅 처리 중 오류 발생 (POST):', e.message);
        // 포트원 서버에 오류를 알려 재시도를 유도할 수 있음
        return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 오류 발생' }, { status: 500 });
    }
}
