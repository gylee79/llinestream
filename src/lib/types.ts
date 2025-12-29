
'use client';

import type { Timestamp as FirebaseTimestamp } from 'firebase/firestore';

// We use the client-side Timestamp for all client-facing components and types.
// For server-side operations (like in `complete/route.ts`), we will convert as needed.
export type Timestamp = FirebaseTimestamp | Date;

export interface User {
  id: string; // This will be the document ID from Firestore, added on the client
  name: string;
  email: string;
  phone: string;
  dob: string; // Date of Birth YYYY-MM-DD
  role: 'user' | 'admin';
  activeSubscriptions: {
    [classificationId: string]: {
      expiresAt: Timestamp;
      purchasedAt: Timestamp;
    };
  };
  createdAt: Timestamp;
}

export interface Field {
  id: string; // This will be the document ID from Firestore, added on the client
  name: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
}

export interface Classification {
  id:string; // This will be the document ID from Firestore, added on the client
  fieldId: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  prices: {
    day1: number;
    day30: number;
    day60: number;
    day90: number;
  };
}

export interface Course {
  id: string; // This will be the document ID from Firestore, added on the client
  classificationId: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
}

export interface Episode {
  id: string; // This will be the document ID from Firestore, added on the client
  courseId: string;
  instructorId?: string;
  title: string;
  description?: string;
  duration: number; // in seconds
  isFree: boolean;
  videoUrl: string;
  filePath?: string; // Path in Firebase Storage
  // The single source of truth for the thumbnail to be displayed.
  // This will be the customThumbnailUrl if it exists, otherwise the defaultThumbnailUrl.
  thumbnailUrl: string;
  
  // Paths and URLs for the two types of thumbnails
  defaultThumbnailUrl?: string;
  defaultThumbnailPath?: string;
  customThumbnailUrl?: string;
  customThumbnailPath?: string;

  createdAt: Timestamp;
}

export interface ViewHistoryItem {
  id: string; // Should be episodeId
  courseId: string;
  lastWatched: Timestamp;
  progress: number; // 0 to 1
}

export interface Policy {
  id: string; // This will be the document ID from Firestore, added on the client
  slug: 'terms' | 'privacy' | 'refund';
  title: string;
  content: string;
}

export interface Subscription {
    id: string; // This will be the document ID from Firestore (same as paymentId)
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
  urlMobile?: string;
  title?: string;
  description?: string;
}

export interface HeroImageSettings {
  home: HeroContent;
  about: HeroContent;
}

export interface Instructor {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string; // YYYY-MM-DD
  createdAt: Timestamp;
}
