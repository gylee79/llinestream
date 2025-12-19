
import type { Timestamp as FirebaseTimestamp } from 'firebase/firestore';

// We use the client-side Timestamp for all client-facing components and types.
// For server-side operations (like in `complete/route.ts`), we will convert as needed.
export type Timestamp = FirebaseTimestamp;

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string; // Date of Birth YYYY-MM-DD
  role: 'user' | 'admin';
  activeSubscriptions?: {
    [classificationId: string]: {
      expiresAt: Timestamp;
      purchasedAt: Timestamp; // Keep this consistent
    };
  };
  createdAt: Timestamp;
}

export interface Field {
  id: string;
  name: string;
}

export interface Classification {
  id: string;
  fieldId: string;
  name: string;
  description: string;
  prices: {
    day1: number;
    day30: number;
    day60: number;
    day90: number;
  };
  thumbnailUrl: string;
  thumbnailHint: string;
}

export interface Course {
  id: string;
  classificationId: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailHint: string;
}

export interface Episode {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  duration: number; // in seconds
  isFree: boolean;
  videoUrl: string;
}

export interface Policy {
  slug: 'terms' | 'privacy' | 'refund';
  title: string;
  content: string;
}

export interface Subscription {
    id: string; // Should be the same as classificationId for easy lookup
    userId: string;
    classificationId: string;
    purchasedAt: Timestamp;
    expiresAt: Timestamp;
    // For record-keeping
    amount: number;
    orderName: string;
    paymentId: string;
    status: string;
    method: string;
}

export interface FooterSettings {
  appName: string;
  slogan: string;
  copyright: string;
  companyName: string;
  representative: string;
  businessNumber: string;
  address: string;
  supportPhone: string;
  supportHours: string;

  kakaoTalkUrl?: string;
}

export interface HeroContent {
  url?: string;
  hint?: string;
  title?: string;
  description?: string;
}

export interface HeroImageSettings {
  home: HeroContent;
  about: HeroContent;
}
