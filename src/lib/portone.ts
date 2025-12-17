
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
  noticeUrls?: string[];
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


export interface PortOneWebhookData {
    paymentId: string;
    status: 'PAID' | 'FAILED' | 'CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED';
    // ... 다른 필드들이 있을 수 있음
}

/**
 * @interface PortOneWebhookRequest
 * @description 포트원 서버-SDK 웹훅 객체 타입
 * @see https://github.com/portone-io/portone-nodejs-sdk/blob/main/src/webhook.ts
 */
export interface PortOneWebhookRequest {
  id: string; // Event ID
  paymentId: string;
  status: 'PAID' | 'FAILED' | 'CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED';
  timestamp: string;
  data: PortOneWebhookData;
}


/**
 * @interface PortOnePayment
 * @description 포트원 결제내역 단건조회 API 응답 타입 (서버 SDK)
 * @see https://github.com/portone-io/portone-nodejs-sdk/blob/main/src/v2/payment.ts#L199
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
    name?: string;
    email?: string;
    phoneNumber?: string;
  };
  method?: {
    name?: string;
  };
  orderName: string;
  // ... 기타 결제 정보
}
