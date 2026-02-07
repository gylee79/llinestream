import { Field, Classification, Course, Episode, User, Subscription, Policy, Timestamp, Instructor } from './types';
import { Timestamp as FirebaseTimestamp } from 'firebase/firestore';


// We are now using plain Date objects here because server-side Timestamps cannot be used in client-side mock data.
// The `data-uploader.ts` script will convert these to Firestore Timestamps before uploading.

export const instructors: Omit<Instructor, 'id' | 'createdAt'>[] = [];

// Mock Users
export const users: (Omit<User, 'id' | 'activeSubscriptions' | 'createdAt'> & { createdAt: Date })[] = [];

export const fields: Omit<Field, 'id'>[] = [];

export const classifications: Omit<Classification, 'id' | 'fieldId'>[] = [];

export const courses: (Omit<Course, 'id' | 'classificationId'> & { prices: { day1: number, day30: number, day60: number, day90: number } })[] = [];

export const episodes: (Omit<Episode, 'id'| 'courseId' | 'createdAt'> & { createdAt: Date })[] = [];

export const subscriptions: (Omit<Subscription, 'id' | 'purchasedAt' | 'expiresAt'> & { purchasedAt: Date, expiresAt: Date })[] = [];

// This data will be used by the data-uploader script.
export const policies: Omit<Policy, 'id'>[] = [
    {
        slug: 'terms',
        title: '서비스 이용약관',
        content: `
### 제1조 (목적)
이 약관은 LlineStream이 제공하는 비디오 스트리밍 서비스 및 관련 제반 서비스의 이용과 관련하여 회사와 회원과의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.

### 제2조 (정의)
이 약관에서 사용하는 용어의 정의는 다음과 같습니다.
1. "서비스"라 함은 구현되는 단말기(PC, TV, 휴대형단말기 등의 각종 유무선 장치를 포함)와 상관없이 "회원"이 이용할 수 있는 LlineStream 및 관련 제반 서비스를 의미합니다.
2. "회원"이라 함은 회사의 "서비스"에 접속하여 이 약관에 따라 "회사"와 이용계약을 체결하고 "회사"가 제공하는 "서비스"를 이용하는 고객을 말합니다.
... (이하 생략) ...
        `,
    },
    {
        slug: 'privacy',
        title: '개인정보처리방침',
        content: `
LlineStream('llinestream.com'이하 'LlineStream')은 개인정보보호법에 따라 이용자의 개인정보 및 권익을 보호하고 개인정보와 관련한 이용자의 고충을 원활하게 처리할 수 있도록 다음과 같은 처리방침을 두고 있습니다.
LlineStream은 개인정보처리방침을 개정하는 경우 웹사이트 공지사항(또는 개별공지)을 통하여 공지할 것입니다.

### 1. 개인정보의 처리 목적
LlineStream은 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 개인정보 보호법 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.
가. 홈페이지 회원가입 및 관리
회원 가입의사 확인, 회원제 서비스 제공에 따른 본인 식별·인증, 회원자격 유지·관리, 서비스 부정이용 방지, 만 14세 미만 아동의 개인정보 처리 시 법정대리인의 동의여부 확인, 각종 고지·통지, 고충처리 등을 목적으로 개인정보를 처리합니다.
... (이하 생략) ...
        `,
    },
    {
        slug: 'refund',
        title: '환불 규정',
        content: `
### 제1조 (환불 원칙)
1. 회원은 다음 각 호의 경우에 한하여 회사에 유료 서비스의 환불을 요청할 수 있습니다.
   가. 유료 서비스를 결제하였으나, 회사의 귀책사유로 인하여 서비스를 전혀 이용하지 못한 경우
   나. 구매한 상품이 표시 또는 광고된 내용과 다르거나 계약 내용과 다르게 이행된 경우
2. 구독 상품의 경우, 이용 내역이 없는 경우에 한하여 결제일로부터 7일 이내에 청약 철회가 가능합니다.
3. 7일이 경과하였거나 이용 내역이 있는 경우, 해지 시점부터 잔여 기간에 대해 일할 계산하여 환불해 드립니다.

### 제2조 (환불 불가)
다음 각 호의 경우에는 환불이 불가능합니다.
1. 회원의 귀책사유로 이용 정지되거나 탈퇴한 경우
2. 회사가 무료로 제공한 보너스 기간 또는 콘텐츠
... (이하 생략) ...
        `,
    }
];
