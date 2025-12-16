
/**
 * @file PortOne V2 SDK의 타입 정의 파일
 * @see https://developers.portone.io/docs/ko/sdk/javascript-sdk/types
 */

// 결제 수단
export type PayMethod =
  | 'CARD'
  | 'VIRTUAL_ACCOUNT'
  | 'BANK_TRANSFER'
  | 'MOBILE_PHONE';

// 화폐 단위
export type Currency = 'KRW' | 'USD' | 'JPY';

// PG사
export type PGProvider = 'nice_v2' | 'inicis_v2';

/**
 * @interface PortOnePaymentRequest
 * @see https://developers.portone.io/docs/ko/sdk/javascript-sdk/request-payment
 */
export interface PortOnePaymentRequest {
  storeId: string;
  channelKey?: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency?: Currency;
  payMethod?: PayMethod;
  customer?: {
    customerId?: string;
    fullName?: string;
    phoneNumber?: string;
    email?: string;
  };
  redirectUrl?: string;
  appScheme?: string;
}

/**
 * @interface PortOnePaymentResponse
 * @see https://developers.portone.io/docs/ko/sdk/javascript-sdk/request-payment#response-%ED%98%95%EC%8B%9D
 */
export interface PortOnePaymentResponse {
  code?: string;
  message?: string;
  paymentId?: string;
  pgCode?: string;
  pgMessage?: string;
}

/**
 * @interface PortOneWebhookRequest
 * @see https://developers.portone.io/docs/ko/api/webhook#request-%EB%B0%94%EB%94%94
 * This interface is for the newer webhook version (2024-04-25).
 */
export interface PortOneWebhookRequest {
  id: string; // The event ID, which corresponds to paymentId for transaction events
  type: string; // e.g., "Transaction.Paid"
  status?: 'PAID' | 'FAILED' | 'CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED'; // Legacy or included for compatibility
  timestamp: string;
  data: {
    storeId: string;
    paymentId: string;
    // ... other properties depending on event type
  };
}

/**
 * @interface PortOnePayment
 * @description 포트원 결제내역 단건조회 API 응답 타입
 * @see https://developers.portone.io/docs/ko/api/payment-api/payment-lookup#response-%EB%B0%94%EB%94%94
 */
export interface PortOnePayment {
  id: string;
  storeId: string;
  status: 'PAID' | 'READY' | 'FAILED' | 'CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED';
  amount: {
    total: number;
    // ... 기타 금액 정보
  };
  customer?: {
    id?: string;
    // ... 기타 고객 정보
  };
  method?: {
    name?: string;
  };
  orderName: string;
  // ... 기타 결제 정보
}
