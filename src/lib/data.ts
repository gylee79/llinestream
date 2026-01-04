
import { Field, Classification, Course, Episode, User, Subscription, Policy, Timestamp } from './types';
import { Timestamp as FirebaseTimestamp } from 'firebase/firestore';


// We are now using plain Date objects here because server-side Timestamps cannot be used in client-side mock data.
// The `data-uploader.ts` script will convert these to Firestore Timestamps before uploading.

// Mock Users
export const users: (Omit<User, 'id' | 'activeSubscriptions' | 'createdAt'> & { createdAt: Date })[] = [
  { name: '김관리', email: 'admin@llinestream.com', phone: '010-1111-1111', dob: '1980-01-01', role: 'admin', createdAt: new Date('2023-01-15') },
  { name: '이사용', email: 'user1@example.com', phone: '010-2222-2222', dob: '1995-05-20', role: 'user', createdAt: new Date('2023-03-10') },
  { name: '박테스트', email: 'user2@example.com', phone: '010-3333-3333', dob: '1992-11-30', role: 'user', createdAt: new Date('2023-04-01') },
  { name: '최유저', email: 'user3@example.com', phone: '010-4444-4444', dob: '2000-02-25', role: 'user', createdAt: new Date('2023-05-22') },
  { name: '정학생', email: 'user4@example.com', phone: '010-5555-5555', dob: '1998-07-12', role: 'user', createdAt: new Date('2023-06-18') },
  { name: '강시청', email: 'user5@example.com', phone: '010-6666-6666', dob: '1993-09-03', role: 'user', createdAt: new Date('2023-07-01') },
  { name: '조개발', email: 'user6@example.com', phone: '010-7777-7777', dob: '1989-12-25', role: 'user', createdAt: new Date('2023-08-11') },
  { name: '윤디자인', email: 'user7@example.com', phone: '010-8888-8888', dob: '1997-04-16', role: 'user', createdAt: new Date('2023-09-05') },
  { name: '장기획', email: 'user8@example.com', phone: '010-9999-9999', dob: '1991-08-28', role: 'user', createdAt: new Date('2023-10-15') },
  { name: '임신입', email: 'user9@example.com', phone: '010-0000-0000', dob: '2002-03-01', role: 'user', createdAt: new Date('2023-11-20') },
];

export const fields: Omit<Field, 'id'>[] = [
  { name: '교육', thumbnailUrl: 'https://picsum.photos/seed/education/100/100' },
  { name: '영화', thumbnailUrl: 'https://picsum.photos/seed/movie/100/100' },
  { name: '라이프스타일', thumbnailUrl: 'https://picsum.photos/seed/lifestyle/100/100' },
];

export const classifications: Omit<Classification, 'id' | 'fieldId'>[] = [
  { name: '코딩', description: '기초부터 실전까지, 다양한 프로그래밍 언어와 기술을 배워보세요.', thumbnailUrl: 'https://picsum.photos/seed/coding/600/400' },
  { name: '액션', description: '숨막히는 추격전과 화려한 액션을 즐겨보세요.', thumbnailUrl: 'https://picsum.photos/seed/action/600/400' },
  { name: '홈트레이닝', description: '집에서 편안하게 전문적인 피트니스 프로그램을 경험하세요.', thumbnailUrl: 'https://picsum.photos/seed/hometraining/600/400' },
  { name: '다큐멘터리', description: '세상의 다양한 지식과 감동적인 이야기를 만나보세요.', thumbnailUrl: 'https://picsum.photos/seed/documentary/600/400' },
  { name: '외국어', description: '영어, 중국어, 일본어 등 새로운 언어의 문을 열어보세요.', thumbnailUrl: 'https://picsum.photos/seed/language/600/400' },
  { name: '요리', description: '세계 각국의 요리를 배우고 나만의 레시피를 만들어보세요.', thumbnailUrl: 'https://picsum.photos/seed/cooking/600/400' },
];

export const courses: (Omit<Course, 'id' | 'classificationId'> & { prices: { day1: number, day30: number, day60: number, day90: number } })[] = [
  { name: 'React 마스터 클래스', description: '컴포넌트 기반 아키텍처부터 최신 기능까지 React의 모든 것을 마스터합니다.', thumbnailUrl: 'https://picsum.photos/seed/101/600/400', prices: { day1: 1000, day30: 9900, day60: 18000, day90: 25000 } },
  { name: '스페이스 어드벤처', description: '광활한 우주를 배경으로 펼쳐지는 위대한 여정. 미지의 행성을 탐사하고 외계의 위협에 맞서 싸우세요.', thumbnailUrl: 'https://picsum.photos/seed/102/600/400', prices: { day1: 1500, day30: 12900, day60: 24000, day90: 34000 } },
  { name: '매일 30분 요가', description: '하루 30분 투자로 몸과 마음의 균형을 찾으세요. 초보자도 쉽게 따라할 수 있습니다.', thumbnailUrl: 'https://picsum.photos/seed/103/600/400', prices: { day1: 800, day30: 7900, day60: 14000, day90: 20000 } },
  { name: 'Python 기초', description: '프로그래밍이 처음이신가요? Python으로 쉽고 재미있게 시작해보세요.', thumbnailUrl: 'https://picsum.photos/seed/104/600/400', prices: { day1: 1000, day30: 9900, day60: 18000, day90: 25000 } },
  { name: '블록버스터 액션', description: '도시를 구하기 위한 영웅의 이야기. 스케일이 다른 액션을 경험하세요.', thumbnailUrl: 'https://picsum.photos/seed/105/600/400', prices: { day1: 0, day30: 0, day60: 0, day90: 0 } },
  { name: '위대한 자연', description: '경이로운 자연의 모습을 담은 다큐멘터리 시리즈.', thumbnailUrl: 'https://picsum.photos/seed/106/600/400', prices: { day1: 0, day30: 0, day60: 0, day90: 0 } },
  { name: '비즈니스 영어 회화', description: '실전 비즈니스 상황에서 자신감있게 소통하는 법을 배웁니다.', thumbnailUrl: 'https://picsum.photos/seed/107/600/400', prices: { day1: 900, day30: 8900, day60: 16000, day90: 23000 } },
  { name: '이탈리안 가정식', description: '파스타, 피자 등 사랑받는 이탈리안 요리를 집에서 만들어보세요.', thumbnailUrl: 'https://picsum.photos/seed/108/600/400', prices: { day1: 700, day30: 6900, day60: 12000, day90: 18000 } },
  { name: 'Node.js 백엔드 개발', description: 'JavaScript로 확장 가능한 고성능 서버를 구축하는 방법을 배웁니다.', thumbnailUrl: 'https://picsum.photos/seed/109/600/400', prices: { day1: 1100, day30: 10900, day60: 20000, day90: 28000 } },
  { name: '미스터리 스릴러', description: '예측할 수 없는 반전, 손에 땀을 쥐게 하는 긴장감을 느껴보세요.', thumbnailUrl: 'https://picsum.photos/seed/110/600/400', prices: { day1: 1500, day30: 12900, day60: 24000, day90: 34000 } },
];

export const episodes: (Omit<Episode, 'id'| 'courseId' | 'createdAt'> & { createdAt: Date })[] = [
  // React 마스터 클래스 (course-001)
  { title: '1. React 소개 및 환경 설정', duration: 980, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-001/600/400', createdAt: new Date() },
  { title: '2. JSX와 컴포넌트의 이해', duration: 1230, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-002/600/400', createdAt: new Date() },
  { title: '3. State와 Lifecycle', duration: 1500, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-003/600/400', createdAt: new Date() },
  { title: '4. Hooks 완전 정복', duration: 1850, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-004/600/400', createdAt: new Date() },

  // 스페이스 어드벤처 (course-002)
  { title: '제1화: 새로운 시작', duration: 2700, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-005/600/400', createdAt: new Date() },
  { title: '제2화: 미지의 신호', duration: 2850, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-006/600/400', createdAt: new Date() },
  { title: '제3화: 첫 번째 접촉', duration: 2640, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-007/600/400', createdAt: new Date() },

  // 매일 30분 요가 (course-003)
  { title: 'Week 1: 기본 자세 익히기', duration: 1800, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-008/600/400', createdAt: new Date() },
  { title: 'Week 2: 코어 강화', duration: 1860, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-009/600/400', createdAt: new Date() },
  
  // Python 기초 (course-004)
  { title: '1. 변수와 자료형', duration: 1100, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-010/600/400', createdAt: new Date() },
  { title: '2. 제어문 (if, for, while)', duration: 1400, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-011/600/400', createdAt: new Date() },
  
  // 블록버스터 액션 (course-005)
  { title: '블록버스터 액션', duration: 7200, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-012/600/400', createdAt: new Date() },

  // 위대한 자연 (course-006)
  { title: '1. 숲의 지배자들', duration: 3200, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-013/600/400', createdAt: new Date() },
  { title: '2. 바다의 거인들', duration: 3300, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-014/600/400', createdAt: new Date() },

  // 비즈니스 영어 회화 (course-007)
  { title: '1. 인사와 소개', duration: 1300, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-015/600/400', createdAt: new Date() },
  { title: '2. 전화 및 이메일', duration: 1550, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-016/600/400', createdAt: new Date() },

  // 이탈리안 가정식 (course-008)
  { title: '1. 완벽한 토마토 소스 만들기', duration: 1900, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-017/600/400', createdAt: new Date() },
  { title: '2. 생면 파스타 도전', duration: 2200, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-018/600/400', createdAt: new Date() },

  // Node.js 백엔드 개발 (course-009)
  { title: '1. Express.js 시작하기', duration: 1200, isFree: true, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-019/600/400', createdAt: new Date() },
  { title: '2. REST API 설계', duration: 1600, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-020/600/400', createdAt: new Date() },

  // 미스터리 스릴러 (course-010)
  { title: '사라진 저택의 비밀', duration: 6800, isFree: false, videoUrl: '', filePath: '', thumbnailUrl: 'https://picsum.photos/seed/ep-021/600/400', createdAt: new Date() },
];

export const subscriptions: (Omit<Subscription, 'id' | 'purchasedAt' | 'expiresAt'> & { purchasedAt: Date, expiresAt: Date })[] = [
    { userId: 'user1@example.com', courseId: 'course-1', purchasedAt: new Date('2024-05-01'), expiresAt: new Date('2024-05-31'), amount: 9900, orderName: 'React 마스터 클래스 30일 이용권', paymentId: 'pmt-mock-001', status: 'PAID', method: 'CARD' },
    { userId: 'user2@example.com', courseId: 'course-2', purchasedAt: new Date('2024-05-10'), expiresAt: new Date('2024-06-10'), amount: 12900, orderName: '스페이스 어드벤처 30일 이용권', paymentId: 'pmt-mock-002', status: 'PAID', method: 'CARD' },
    { userId: 'user1@example.com', courseId: 'course-3', purchasedAt: new Date('2024-05-15'), expiresAt: new Date('2024-07-15'), amount: 14000, orderName: '매일 30분 요가 60일 이용권', paymentId: 'pmt-mock-003', status: 'PAID', method: 'CARD' },
    { userId: 'user3@example.com', courseId: 'course-1', purchasedAt: new Date('2024-05-20'), expiresAt: new Date('2024-06-20'), amount: 9900, orderName: 'React 마스터 클래스 30일 이용권', paymentId: 'pmt-mock-004', status: 'PAID', method: 'CARD' },
    { userId: 'user4@example.com', courseId: 'course-7', purchasedAt: new Date('2024-05-25'), expiresAt: new Date('2024-06-25'), amount: 8900, orderName: '비즈니스 영어 회화 30일 이용권', paymentId: 'pmt-mock-005', status: 'PAID', method: 'CARD' },
    { userId: 'user5@example.com', courseId: 'course-8', purchasedAt: new Date('2024-06-01'), expiresAt: new Date('2024-07-01'), amount: 6900, orderName: '이탈리안 가정식 30일 이용권', paymentId: 'pmt-mock-006', status: 'PAID', method: 'CARD' },
    { userId: 'admin@llinestream.com', courseId: 'course-1', purchasedAt: new Date('2024-01-01'), expiresAt: new Date('2099-12-31'), amount: 0, orderName: 'React 마스터 클래스 영구 이용권', paymentId: 'pmt-mock-admin-001', status: 'PAID', method: 'INTERNAL' },
    { userId: 'admin@llinestream.com', courseId: 'course-2', purchasedAt: new Date('2024-01-01'), expiresAt: new Date('2099-12-31'), amount: 0, orderName: '스페이스 어드벤처 영구 이용권', paymentId: 'pmt-mock-admin-002', status: 'PAID', method: 'INTERNAL' },
    { userId: 'user6@example.com', courseId: 'course-1', purchasedAt: new Date('2024-06-05'), expiresAt: new Date('2024-07-05'), amount: 9900, orderName: 'React 마스터 클래스 30일 이용권', paymentId: 'pmt-mock-007', status: 'PAID', method: 'CARD' },
    { userId: 'user7@example.com', courseId: 'course-3', purchasedAt: new Date('2024-06-10'), expiresAt: new Date('2024-08-10'), amount: 14000, orderName: '매일 30분 요가 60일 이용권', paymentId: 'pmt-mock-008', status: 'PAID', method: 'CARD' },
];

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
