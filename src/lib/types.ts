
'use client';

import type { Timestamp as FirebaseTimestamp, FieldValue } from 'firebase/firestore';
import type { UseEmblaCarouselType } from 'embla-carousel-react';

// This union type can represent a client-side Timestamp or a server-side FieldValue for server timestamps.
export type Timestamp = FirebaseTimestamp | FieldValue;

export interface User {
  id: string; // This will be the document ID from Firestore, added on the client
  name: string;
  email: string;
  phone: string;
  dob: string; // Date of Birth YYYY-MM-DD
  role: 'user' | 'admin';
  activeSubscriptions: {
    [courseId: string]: { // Changed from classificationId to courseId
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
  // prices field is removed from here
}

export interface Course {
  id: string; // This will be the document ID from Firestore, added on the client
  classificationId: string;
  instructorId?: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  introImageUrls?: string[];
  introImagePaths?: string[];
  // New fields for richer display
  level?: '입문' | '초급' | '중급' | '고급';
  tags?: string[];
  rating?: number;
  reviewCount?: number;
  // prices field is added here
  prices: {
    day1: number;
    day30: number;
    day60: number;
    day90: number;
  };
  createdAt?: Timestamp;
}

export interface Episode {
  id: string; // This will be the document ID from Firestore, added on the client
  courseId: string;
  instructorId: string;
  title: string;
  description?: string;
  duration: number; // in seconds
  isFree: boolean;
  videoUrl: string;
  filePath?: string; // Path in Firebase Storage
  fileSize?: number; // Size in bytes
  // The single source of truth for the thumbnail to be displayed.
  // This will be the customThumbnailUrl if it exists, otherwise the defaultThumbnailUrl.
  thumbnailUrl: string;
  
  // Paths and URLs for the two types of thumbnails
  defaultThumbnailUrl?: string;
  defaultThumbnailPath?: string;
  customThumbnailUrl?: string;
  customThumbnailPath?: string;

  transcript?: string | null; // Full transcript from AI, null if processing failed or not started
  vttUrl?: string; // URL for the VTT subtitle file
  vttPath?: string; // Path in Firebase Storage for the VTT file

  aiProcessingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  aiProcessingError?: string | null;
  
  createdAt: Timestamp;
}

export interface ViewHistoryItem {
  id: string; // Should be episodeId
  courseId: string;
  lastWatched: Timestamp;
  progress: number; // 0 to 1
}

export interface EpisodeViewLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  episodeId: string;
  episodeTitle: string;
  courseId: string;
  startedAt: Timestamp;
  endedAt: Timestamp;
  duration: number; // Watched duration in seconds
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
    courseId: string; // Changed from classificationId
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

export interface UserAuditLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  changedAt: Timestamp;
  fieldName: 'name' | 'phone' | 'dob';
  oldValue: string;
  newValue: string;
}

export interface EpisodeComment {
  id: string;
  episodeId: string;
  userId: string;
  userName: string;
  userRole: 'user' | 'admin';
  content: string;
  rating?: number; // 1-5, optional
  createdAt: Timestamp;
}

export type CarouselApi = UseEmblaCarouselType[1];

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: Date;
}

export interface ChatLog {
    id: string;
    userId: string;
    episodeId: string;
    question: string;
    answer: string;
    contextReferences: string[];
    createdAt: Timestamp;
}
