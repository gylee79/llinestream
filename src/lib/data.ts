import { Field, Classification, Course, Episode, User, Policy } from './types';
import { Timestamp } from 'firebase/firestore';

export const fields: Omit<Field, 'id'>[] = [
  { name: '교육' },
  { name: '영화' },
];

export const classifications: Omit<Classification, 'id'>[] = [
  {
    fieldId: 'field-01',
    name: '코딩',
    description: '기초부터 실전까지, 다양한 프로그래밍 언어와 기술을 배워보세요.',
    prices: { day1: 1000, day30: 9900, day60: 18000, day90: 25000 },
  },
  {
    fieldId: 'field-02',
    name: '액션',
    description: '숨막히는 추격전과 화려한 액션을 즐겨보세요.',
    prices: { day1: 1500, day30: 12900, day60: 24000, day90: 34000 },
  },
  {
    fieldId: 'field-01',
    name: '홈트레이닝',
    description: '집에서 편안하게 전문적인 피트니스 프로그램을 경험하세요.',
    prices: { day1: 800, day30: 7900, day60: 14000, day90: 20000 },
  },
  {
    fieldId: 'field-02',
    name: '다큐멘터리',
    description: '세상의 다양한 지식과 감동적인 이야기를 만나보세요.',
    prices: { day1: 0, day30: 0, day60: 0, day90: 0 }, // 무료 카테고리
  },
];

export const courses: Omit<Course, 'id'>[] = [
  {
    classificationId: 'class-001',
    name: 'React 마스터 클래스',
    description: '컴포넌트 기반 아키텍처부터 최신 기능까지 React의 모든 것을 마스터합니다.',
    thumbnailUrl: 'https://picsum.photos/seed/101/600/400',
    thumbnailHint: 'code laptop'
  },
  {
    classificationId: 'class-002',
    name: '스페이스 어드벤처',
    description: '광활한 우주를 배경으로 펼쳐지는 위대한 여정. 미지의 행성을 탐사하고 외계의 위협에 맞서 싸우세요.',
    thumbnailUrl: 'https://picsum.photos/seed/102/600/400',
    thumbnailHint: 'galaxy planet'
  },
  {
    classificationId: 'class-003',
    name: '매일 30분 요가',
    description: '하루 30분 투자로 몸과 마음의 균형을 찾으세요. 초보자도 쉽게 따라할 수 있습니다.',
    thumbnailUrl: 'https://picsum.photos/seed/103/600/400',
    thumbnailHint: 'yoga mat'
  },
  {
    classificationId: 'class-001',
    name: 'Python 기초',
    description: '프로그래밍이 처음이신가요? Python으로 쉽고 재미있게 시작해보세요.',
    thumbnailUrl: 'https://picsum.photos/seed/104/600/400',
    thumbnailHint: 'python code'
  },
  {
    classificationId: 'class-002',
    name: '블록버스터 액션',
    description: '도시를 구하기 위한 영웅의 이야기. 스케일이 다른 액션을 경험하세요.',
    thumbnailUrl: 'https://picsum.photos/seed/105/600/400',
    thumbnailHint: 'car explosion'
  },
  {
    classificationId: 'class-004',
    name: '위대한 자연',
    description: '경이로운 자연의 모습을 담은 다큐멘터리 시리즈.',
    thumbnailUrl: 'https://picsum.photos/seed/106/600/400',
    thumbnailHint: 'wildlife forest'
  },
];

export const episodes: Omit<Episode, 'id'>[] = [
  // React 마스터 클래스
  { courseId: 'course-001', title: '1. React 소개 및 환경 설정', duration: 980, isFree: true, videoUrl: '' },
  { courseId: 'course-001', title: '2. JSX와 컴포넌트의 이해', duration: 1230, isFree: false, videoUrl: '' },
  { courseId: 'course-001', title: '3. State와 Lifecycle', duration: 1500, isFree: false, videoUrl: '' },
  { courseId: 'course-001', title: '4. Hooks 완전 정복', duration: 1850, isFree: false, videoUrl: '' },

  // 스페이스 어드벤처
  { courseId: 'course-002', title: '제1화: 새로운 시작', duration: 2700, isFree: true, videoUrl: '' },
  { courseId: 'course-002', title: '제2화: 미지의 신호', duration: 2850, isFree: false, videoUrl: '' },
  { courseId: 'course-002', title: '제3화: 첫 번째 접촉', duration: 2640, isFree: false, videoUrl: '' },

  // 매일 30분 요가
  { courseId: 'course-003', title: 'Week 1: 기본 자세 익히기', duration: 1800, isFree: true, videoUrl: '' },
  { courseId: 'course-003', title: 'Week 2: 코어 강화', duration: 1860, isFree: false, videoUrl: '' },
  
  // Python 기초
  { courseId: 'course-004', title: '1. 변수와 자료형', duration: 1100, isFree: true, videoUrl: '' },
  { courseId: 'course-004', title: '2. 제어문 (if, for, while)', duration: 1400, isFree: false, videoUrl: '' },
  
  // 블록버스터 액션
  { courseId: 'course-005', title: '블록버스터 액션', duration: 7200, isFree: false, videoUrl: '' },

  // 위대한 자연
  { courseId: 'course-006', title: '1. 숲의 지배자들', duration: 3200, isFree: true, videoUrl: '' },
  { courseId: 'course-006', title: '2. 바다의 거인들', duration: 3300, isFree: true, videoUrl: '' },
];


export const mockUsers: User[] = [
  {
    id: 'user-001',
    name: '홍길동',
    email: 'user@example.com',
    phone: '010-1234-5678',
    dob: '1990-01-01',
    activeSubscriptions: {
      'class-001': { expiresAt: Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 25))) }
    },
    createdAt: Timestamp.fromDate(new Date('2023-01-15')),
  },
  {
    id: 'user-002',
    name: '김관리',
    email: 'admin@example.com',
    phone: '010-9876-5432',
    dob: '1985-05-10',
    activeSubscriptions: {
      'class-001': { expiresAt: Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 365))) },
      'class-002': { expiresAt: Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 365))) },
      'class-003': { expiresAt: Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + 365))) },
    },
    createdAt: Timestamp.fromDate(new Date('2022-11-20')),
  }
];

export const policies: Policy[] = [
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

// Helper functions are no longer needed as we will fetch from Firestore
// export const getCoursesByClassification = (classificationId: string) => courses.filter(c => c.classificationId === classificationId);
// export const getEpisodesByCourse = (courseId: string) => episodes.filter(e => e.courseId === courseId);
// export const getCourseById = (id: string) => courses.find(c => c.id === id);
// export const getClassificationById = (id: string) => classifications.find(c => c.id === id);
export const getPolicyBySlug = (slug: string) => policies.find(p => p.slug === slug);
