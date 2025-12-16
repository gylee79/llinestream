'use server';

import { NextRequest, NextResponse } from 'next/server';
import { doc, getDocs, Timestamp, collection, where, query, limit, writeBatch } from 'firebase/firestore';
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

async function verifyAndProcessPayment(paymentId: string): Promise<{ success: boolean, message: string, classificationName?: string }> {
    const firestore = admin.firestore();

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
    
    if (paymentData.status !== 'PAID') {
        const message = `결제가 완료되지 않았습니다. (상태: ${paymentData.status})`;
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
        return { success: false, message };
    }

    const userRef = doc(firestore, 'users', userId);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    const subscriptionRef = doc(collection(userRef, 'subscriptions'), targetClassification.id);
    const batch = firestore.batch();

    const newSubscription: Omit<Subscription, 'id'> = {
        userId: userId,
        classificationId: targetClassification.id,
        purchasedAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expiresAt),
    };

    batch.set(subscriptionRef, newSubscription);

    batch.update(userRef, {
        [`activeSubscriptions.${targetClassification.id}`]: {
            expiresAt: Timestamp.fromDate(expiresAt),
            purchasedAt: Timestamp.now()
        }
    });
    
    await batch.commit();

    return { success: true, message: '결제가 성공적으로 처리되었습니다.', classificationName };
}

export async function POST(req: NextRequest) {
    initializeAdminApp();
    
    try {
        const webhookData: PortOneWebhookRequest = await req.json();
        const { paymentId, status } = webhookData;

        if (!paymentId) {
            return NextResponse.json({ success: false, message: 'paymentId가 없습니다.' }, { status: 400 });
        }

        if (status === 'PAID') {
            const result = await verifyAndProcessPayment(paymentId);
            if (result.success) {
                return NextResponse.json({ success: true, message: result.message });
            } else {
                return NextResponse.json({ success: false, message: result.message }, { status: 500 });
            }
        } else {
            console.log(`[WEBHOOK_RECEIVED] Non-PAID status received: ${status} for paymentId: ${paymentId}`);
            return NextResponse.json({ success: true, message: `Webhook for status '${status}' received.` });
        }
    } catch (e: any) {
        console.error('웹훅 처리 중 오류 발생 (POST):', e.message);
        return NextResponse.json({ success: false, message: e.message || '웹훅 처리 중 알 수 없는 오류 발생' }, { status: 500 });
    }
}
