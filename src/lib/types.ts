export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  dob?: string; // Date of Birth
  activeSubscriptions: {
    [classificationId: string]: {
      expiresAt: Date;
    };
  };
  createdAt: Date;
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
  duration: number; // in seconds
  isFree: boolean;
  videoUrl: string;
}

export interface Policy {
  slug: 'terms' | 'privacy' | 'refund';
  title: string;
  content: string;
}
