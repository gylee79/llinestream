
import { NextRequest, NextResponse } from 'next/server';

/**
 * 이 핸들러는 PortOne 결제 완료 후 사용자가 리디렉션되는 엔드포인트입니다.
 * 
 * 중요: 이 핸들러는 더 이상 결제 검증이나 데이터베이스 쓰기를 직접 수행하지 않습니다.
 * 모든 중요한 서버 로직은 이제 /api/webhook/portone 엔드포인트에서 비동기적으로 처리됩니다.
 * 
 * 이 핸들러의 역할:
 * 1. PortOne이 리디렉션 시 함께 보낸 쿼리 파라미터를 확인합니다.
 * 2. 결제가 성공적으로 시작되었는지(code가 없는 경우), 아니면 실패했는지(code가 있는 경우) 판단합니다.
 * 3. 결과에 따라 사용자를 적절한 최종 페이지(성공 또는 실패 페이지)로 리디렉션합니다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const paymentId = searchParams.get('paymentId');
  const code = searchParams.get('code');
  const message = searchParams.get('message');

  // 결제 실패 또는 사용자가 결제 창을 닫은 경우
  if (code || !paymentId) {
    const failureUrl = new URL('/pricing', req.url);
    failureUrl.searchParams.set('error', message || '결제를 완료하지 못했습니다.');
    return NextResponse.redirect(failureUrl);
  }

  // 결제 성공 (또는 성공적으로 시작됨)
  // 실제 데이터 처리는 웹훅이 담당하므로, 여기서는 사용자에게 즉시 긍정적인 피드백을 주고 성공 페이지로 보냅니다.
  const successUrl = new URL('/contents', req.url);
  successUrl.searchParams.set('payment_success', 'true');
  successUrl.searchParams.set('message', '결제가 성공적으로 요청되었습니다. 잠시 후 구독 내역이 반영됩니다.');
  
  // 사용자를 최종 성공 페이지로 리디렉션합니다.
  return NextResponse.redirect(successUrl);
}
