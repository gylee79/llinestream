'use server';

import type { Timestamp as FirebaseTimestamp, FieldValue } from 'firebase/firestore';

export type Timestamp = FirebaseTimestamp | FieldValue;

export type PlayerState =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'ready'
  | 'recovering'
  | 'error-fatal'
  | 'error-retryable'
  | 'license-expired'
  | 'requesting-key'
  | 'downloading'
  | 'decrypting';

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

// From Spec 4.3
export interface EncryptionInfo {
  algorithm: "AES-256-GCM";
  ivLength: 12;
  tagLength: 16;
  keyId: string;
  kekVersion: 1;
  aadMode: "path";
  segmentDurationSec: 4;
  fragmentEncrypted: true;
}

// From Spec 4.1
export interface PipelineStatus {
    pipeline: "pending" | "processing" | "failed" | "completed";
    step: "validate" | "ffmpeg" | "encrypt" | "verify" | "manifest" | "keys" | "done" | "idle" | "trigger-exception";
    playable: boolean;
    progress: number;
    jobId?: string;
    startedAt?: Timestamp;
    updatedAt?: Timestamp;
    lastHeartbeatAt?: Timestamp;
    error?: {
        step: string;
        code: string;
        message: string;
        hint?: string;
        raw: string;
        debugLogPath?: string;
        ts: Timestamp;
    } | null;
}

// From Spec 4.4
export interface AiStatus {
    status: "pending" | "processing" | "failed" | "completed" | "blocked" | "idle";
    jobId?: string;
    model?: string;
    attempts?: number;
    lastHeartbeatAt?: Timestamp;
    error?: {
        code: string;
        message: string;
        raw: string;
        debugLogPath?: string;
        ts: Timestamp;
    } | null;
    resultPaths?: {
        transcript?: string;
        summary?: string;
        chapters?: string;
        quiz?: string;
    };
}


export interface Episode {
  id: string;
  courseId: string;
  instructorId: string;
  title: string;
  description?: string;
  duration: number;
  isFree: boolean;
  orderIndex?: number;
  createdAt: Timestamp;
  
  // From Spec 4.2
  storage: {
      rawPath: string; // Original file path, to be archived
      encryptedBasePath: string; // e.g., episodes/{id}/segments/
      manifestPath: string;
      aiAudioPath?: string;
      thumbnailBasePath?: string; // e.g., episodes/{id}/thumbnails/
      fileSize?: number;
  };

  // Replaces flat thumbnail URLs/paths
  thumbnails: {
      default: string; // URL
      defaultPath: string;
      custom?: string | null; // URL
      customPath?: string | null;
  };
  thumbnailUrl: string; // Keep for simple display logic (denormalized from custom or default)

  // Combined Status Objects from Spec
  status: PipelineStatus;
  ai: AiStatus;

  // From Spec 4.3
  encryption: EncryptionInfo;
}

export interface Job {
  id: string;
  type: "VIDEO_PIPELINE" | "AI_ANALYSIS";
  episodeId: string;
  status: "pending" | "running" | "failed" | "succeeded" | "dead";
  attempts: number;
  maxAttempts: number;
  createdAt: Timestamp;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  lastHeartbeatAt?: Timestamp;
  error?: {
    code: string;
    message: string;
    raw: string;
    ts: Timestamp;
  }
}

export interface VideoManifest {
  codec: string;
  duration: number;
  init: string;
  segments: Array<{ path: string; }>;
}


export interface VideoKey {
  keyId: string;
  videoId: string;
  encryptedMasterKey: string; 
  kekVersion: 1;
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

// From Spec 12.2
export interface OfflineLicense {
  videoId: string;
  userId: string;
  deviceId: string;
  issuedAt: number; // timestamp
  expiresAt: number; // timestamp
  keyId: string;
  kekVersion: 1;
  watermarkSeed: string; // Added for offline watermarking
  policy: {
      maxDevices: 1,
      allowScreenCapture: false
  },
  // This signature is crucial but requires a server private key.
  // The client must verify it with a public key.
  signature: string; 
  offlineDerivedKey: string;
}


export interface OfflineVideoData {
  episode: Episode;
  courseName: string;
  downloadedAt: Date;
  license: OfflineLicense;
  manifest: VideoManifest;
  segments: Map<string, ArrayBuffer>;
  aiContent?: any;
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
    encryption: EncryptionInfo;
    storagePath: string; // Added for AAD
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
