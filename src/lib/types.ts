
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
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  orderIndex?: number;
}

export interface Classification {
  id:string; // This will be the document ID from Firestore, added on the client
  fieldId: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  orderIndex?: number;
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
  orderIndex?: number;
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

export interface EncryptionInfo {
  algorithm: 'AES-256-GCM';
  keyId: string;
  ivLength: 12;
  tagLength: 16;
}

export interface Episode {
  id: string;
  courseId: string;
  instructorId: string;
  title: string;
  description?: string;
  duration: number; // in seconds
  isFree: boolean;
  orderIndex?: number;
  thumbnailUrl: string;
  defaultThumbnailUrl?: string;
  defaultThumbnailPath?: string;
  customThumbnailUrl?: string;
  customThumbnailPath?: string;
  
  // File & Storage Information (Legacy & New)
  filePath?: string; // Path to the original uploaded file (will be deleted after processing)
  storage: {
    encryptedPath: string;
    fileSize: number;
  };
  subtitlePath?: string;
  transcriptPath?: string; // Path to the transcript file in Storage

  // Encryption Information
  encryption: EncryptionInfo;

  // Processing Status
  aiProcessingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  aiProcessingError?: string | null;
  aiModel?: string;
  status: {
    processing: 'pending' | 'processing' | 'completed' | 'failed';
    playable: boolean;
    error?: string | null;
  };
  
  // AI Generated Content (summary, timeline etc. without large transcript)
  aiGeneratedContent?: string | null;
  
  createdAt: Timestamp;
}


export interface VideoKey {
  keyId: string;
  videoId: string;
  masterKey: string; // BASE64_32_BYTES_KEY
  rotation: number;
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
  path?: string;
  pathMobile?: string;
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
    courseId: string;
    question: string;
    answer: string;
    contextReferences: string[];
    createdAt: Timestamp;
}

export interface EpisodeAiChunk {
  episodeId: string;
  courseId: string;
  classificationId: string;
  fieldId: string;
  content: string;
  createdAt: Timestamp;
}

export type AiSearchScope = 'episode' | 'course' | 'classification' | 'field';

export interface AITutorSettings {
  defaultSearchScope: AiSearchScope;
}

export interface Bookmark {
  id: string;
  userId: string;
  episodeId: string;
  courseId: string;
  timestamp: number; // in seconds
  note?: string; // Optional note
  createdAt: Timestamp;
   // denormalized for admin view
  userName?: string;
  userEmail?: string;
  episodeTitle?: string;
}
