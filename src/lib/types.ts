
'use server';

import type { Timestamp as FirebaseTimestamp, FieldValue } from 'firebase/firestore';
import type { UseEmblaCarouselType } from 'embla-carousel-react';

export type Timestamp = FirebaseTimestamp | FieldValue;

export type PlayerState =
  | 'idle'
  | 'fetching_manifest'
  | 'fetching_init'
  | 'appending_init'
  | 'fetching_segment'
  | 'appending_segment'
  | 'ended'
  | 'recovering'
  | 'error-fatal'
  | 'license-expired'
  | 'requesting-key';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  dob: string; 
  role: 'user' | 'admin';
  activeSubscriptions: {
    [courseId: string]: {
      expiresAt: Timestamp;
      purchasedAt: Timestamp;
    };
  };
  createdAt: Timestamp;
}

export interface Field {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  orderIndex?: number;
}

export interface Classification {
  id:string;
  fieldId: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  orderIndex?: number;
}

export interface Course {
  id: string;
  classificationId: string;
  instructorId?: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  thumbnailPath?: string;
  introImageUrls?: string[];
  introImagePaths?: string[];
  orderIndex?: number;
  level?: '입문' | '초급' | '중급' | '고급';
  tags?: string[];
  rating?: number;
  reviewCount?: number;
  prices: {
    day1: number;
    day30: number;
    day60: number;
    day90: number;
  };
  createdAt?: Timestamp;
}

export interface VideoManifest {
  codec: string;
  init: string; // path to init.enc
  segments: Array<{ path: string; }>;
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
  
  // File Processing & Status
  filePath?: string; // Original uploaded file path, deleted after processing
  manifestPath?: string; // Path to the manifest.json in storage
  codec?: string; // e.g., 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
  keyId?: string; // ID of the master key in `video_keys` collection

  status: {
    processing: 'pending' | 'processing' | 'completed' | 'failed';
    playable: boolean;
    error?: string | null;
  };
  
  // AI Generated Content
  aiProcessingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  aiProcessingError?: string | null;
  aiModel?: string;
  aiGeneratedContent?: string | null; // summary, timeline etc.
  transcriptPath?: string;
  subtitlePath?: string;
  
  createdAt: Timestamp;
}

export interface VideoKey {
  keyId: string;
  videoId: string;
  encryptedMasterKey: string; 
  createdAt: Timestamp;
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
  duration: number;
}

export interface Policy {
  id: string;
  slug: 'terms' | 'privacy' | 'refund';
  title: string;
  content: string;
}

export interface Subscription {
    id: string;
    userId: string;
    courseId: string;
    purchasedAt: Timestamp;
    expiresAt: Timestamp;
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
  dob: string;
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
  rating?: number;
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

export type AiSearchScope = 'episode' | 'course' | 'classification' | 'field';

export interface AITutorSettings {
  defaultSearchScope: AiSearchScope;
}

export interface Bookmark {
  id: string;
  userId: string;
  episodeId: string;
  courseId: string;
  timestamp: number;
  note?: string;
  createdAt: Timestamp;
  userName?: string;
  userEmail?: string;
  episodeTitle?: string;
}

export interface OfflineLicense {
  videoId: string;
  userId: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
  lastCheckedAt: number;
  scope: "OFFLINE_PLAYBACK";
  watermarkSeed: string;
  watermarkMode: "normal" | "aggressive";
  offlineDerivedKey: string;
}

export interface OfflineVideoData {
  episode: Episode;
  courseName: string;
  downloadedAt: Date;
  license: OfflineLicense;
  manifest: VideoManifest;
  segments: Map<string, ArrayBuffer>;
}


export interface OfflineVideoInfo {
  episodeId: string;
  title: string;
  courseName: string;
  thumbnailUrl: string;
  downloadedAt: Date;
  expiresAt: Date;
}

export type CryptoWorkerRequest = {
  type: 'DECRYPT_SEGMENT';
  payload: {
    requestId: string;
    encryptedSegment: ArrayBuffer;
    derivedKeyB64: string;
    // No longer passing full encryption info, worker logic is simpler
  };
};

export type CryptoWorkerResponse =
  | {
      type: 'DECRYPT_SUCCESS';
      payload: {
        requestId: string;
        decryptedSegment: ArrayBuffer;
      };
    }
  | {
      type: 'DECRYPT_FAILURE';
      payload: {
        requestId: string;
        message: string;
      };
    };
