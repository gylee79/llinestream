import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc, updateDoc, Timestamp, collection } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore/lite';
import { initializeApp, getApps } from 'firebase/app';
import type { Classification, User } from '@/lib/types';
import type { PortOnePayment } from '@/lib/portone';
import { firebaseConfig } from '@/firebase/config';

// Initialize Firebase App for Server-side usage
function initializeServerApp() {
  if (getApps().length) {
    return getApps()[0];
  }
  return initializeApp(firebaseConfig);
}

// POST /api/payment/complete
export async function GET(req: NextRequest) {
    const firestore = getFirestore(initializeServerApp());
    const { searchParams } = new URL(req.url);
    const paymentId = searchParams.get('paymentId');
    const code = searchParams.get('code');
    const message = searchParams.get('message');
    const pgCode = searchParams.get('pg_code');
    const pgMessage = searchParams.get('pg_message');

    // 결제 실패 시 에러 페이지로 리다이렉트
    if (code) {
        console.error(`[결제 실패] ${message} (PG: ${pgMessage})`);
        const failureUrl = new URL('/pricing', req.url);
        failureUrl.searchParams.set('error', message || '결제에 실패했습니다.');
        return NextResponse.redirect(failureUrl);
    }
    
    if (!paymentId) {
        return new NextResponse("paymentId가 없습니다.", { status: 400 });
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
        
        // Firestore에서 이름으로 classification을 찾는 것은 비효율적이므로, 실제 프로덕션에서는
        // customData 필드에 classificationId를 담아 보내는 것이 좋습니다.
        // 여기서는 예시로 모든 classification을 가져와 필터링합니다.
        const classificationsSnapshot = await getDoc(collection(firestore, 'classifications') as any);
        let targetClassification: (Classification & { id: string }) | null = null;
        if (!classificationsSnapshot.empty) {
            classificationsSnapshot.forEach((doc: any) => {
                if (doc.data().name === classificationName) {
                    targetClassification = { id: doc.id, ...doc.data() } as any;
                }
            });
        }
        
        if (!targetClassification) {
            throw new Error(`주문명에 해당하는 상품(${classificationName})을 찾을 수 없습니다.`);
        }

        // 금액 비교 (위변조 검증)
        if (targetClassification.prices.day30 !== paymentData.amount.total) {
            // TODO: 실제 환경에서는 여기서 결제 취소 API를 호출해야 합니다.
            throw new Error(`결제 금액 불일치. 주문 금액: ${targetClassification.prices.day30}, 실제 결제액: ${paymentData.amount.total}`);
        }

        // --- 4. 모든 검증 통과, 사용자에게 이용권 부여 ---
        const userRef = doc(firestore, 'users', userId);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        await updateDoc(userRef, {
            [`activeSubscriptions.${targetClassification.id}`]: {
                expiresAt: Timestamp.fromDate(expiresAt),
            }
        });
        
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
