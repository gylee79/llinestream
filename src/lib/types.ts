import { Timestamp } from 'firebase/firestore';

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
  id: string;
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
}
