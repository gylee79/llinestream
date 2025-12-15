import { NextRequest, NextResponse } from 'next/server';
import { doc, getDocs, updateDoc, Timestamp, collection, where, query, limit } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore/lite';
import { initializeApp, getApps } from 'firebase/app';
import type { Classification, User, Subscription } from '@/lib/types';
import type { PortOnePayment } from '@/lib/portone';
import { firebaseConfig } from '@/firebase/config';
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

// POST /api/payment/complete
export async function GET(req: NextRequest) {
    initializeAdminApp();
    const firestore = admin.firestore();
    const { searchParams } = new URL(req.url);
    const paymentId = searchParams.get('paymentId');
    const code = searchParams.get('code');
    const message = searchParams.get('message');
    const pgMessage = searchParams.get('pg_message');

    // 결제 실패 시 에러 페이지로 리다이렉트
    if (code) {
        console.error(`[결제 실패] ${message} (PG: ${pgMessage})`);
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
        // --- 1. 포트원 결제내역 단건조회 API 호출 (서버) ---
        const paymentResponse = await fetch(
            `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
            {
                headers: { Authorization: `PortOne ${process.env.PORTONE_V2_API_SECRET}` },
            },
        );

        if (!paymentResponse.ok) {
            const errorBody = await paymentResponse.json();
            throw new Error(`결제내역 조회 실패: ${errorBody.message || '알 수 없는 오류'}`);
        }
        
        const paymentData: PortOnePayment = await paymentResponse.json();
        
        // --- 2. 실제 결제 상태 및 금액 검증 ---
        if (paymentData.status !== 'PAID') {
            throw new Error(`결제가 완료되지 않았습니다. (상태: ${paymentData.status})`);
        }

        const userId = paymentData.customer?.id;
        const orderName = paymentData.orderName; // 예: "코딩 30일 이용권"

        if (!userId) {
            throw new Error('사용자 정보가 없어 결제 처리가 불가능합니다.');
        }

        // --- 3. DB에서 상품(Classification) 정보 조회 및 금액 비교 ---
        // "코딩 30일 이용권"에서 "코딩" 부분만 추출
        const classificationName = orderName.split(' ')[0];
        
        const q = query(collection(firestore, 'classifications'), where("name", "==", classificationName), limit(1));
        const classificationsSnapshot = await getDocs(q as any);

        if (classificationsSnapshot.empty) {
             throw new Error(`주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.`);
        }
        
        const targetClassificationDoc = classificationsSnapshot.docs[0];
        const targetClassification = { id: targetClassificationDoc.id, ...targetClassificationDoc.data() } as Classification;
        
        // 금액 비교 (위변조 검증)
        if (targetClassification.prices.day30 !== paymentData.amount.total) {
            // TODO: 실제 환경에서는 여기서 결제 취소 API를 호출해야 합니다.
            throw new Error(`결제 금액 불일치. 주문 금액: ${targetClassification.prices.day30}, 실제 결제액: ${paymentData.amount.total}`);
        }

        // --- 4. 모든 검증 통과, 사용자에게 이용권 부여 ---
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
        
        // --- 5. 결제 성공 페이지로 리다이렉트 ---
        const successUrl = new URL('/contents', req.url); // 성공 시 콘텐츠 페이지로 이동
        successUrl.searchParams.set('payment_success', 'true');
        successUrl.searchParams.set('classification_name', classificationName);
        return NextResponse.redirect(successUrl);

    } catch (e: any) {
        console.error('결제 검증 실패:', e.message);
        // 사용자에게 보여줄 에러 페이지로 리다이렉트
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', e.message || '결제 처리 중 오류가 발생했습니다.');
        return NextResponse.redirect(failureUrl);
    }
}
