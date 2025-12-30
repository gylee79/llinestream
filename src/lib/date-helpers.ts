
import type { Timestamp } from '@/lib/types';
import { Timestamp as FirebaseTimestamp, FieldValue } from 'firebase/firestore';

/**
 * Safely converts a custom Timestamp (which can be a Firestore Timestamp or a JS Date)
 * into a JavaScript Date object.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A JavaScript Date object, or null if the input is invalid or a FieldValue.
 */
export function toJSDate(timestamp: Timestamp | null | undefined): Date | null {
  if (!timestamp) {
    return null;
  }
  if (timestamp instanceof FirebaseTimestamp) {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  // If it's a FieldValue (like a serverTimestamp placeholder), we can't convert it yet.
  if (timestamp instanceof FieldValue) {
    return null;
  }
  return null;
}


/**
 * Safely converts a custom Timestamp into a localized date string for display.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A formatted date string (e.g., 'YYYY. MM. DD.'), or an empty string.
 */
export function toDisplayDate(timestamp: Timestamp | Date | null | undefined): string {
    if (!timestamp) {
        return '';
    }
    const date = toJSDate(timestamp as Timestamp);
    if (!date) {
        return '처리중...'; // Or some other placeholder for server-generated timestamps
    }
    return date.toLocaleDateString('ko-KR');
}

    
