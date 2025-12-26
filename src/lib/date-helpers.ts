
import type { Timestamp } from '@/lib/types';
import { Timestamp as FirebaseTimestamp } from 'firebase/firestore';

/**
 * Safely converts a custom Timestamp (which can be a Firestore Timestamp or a JS Date)
 * into a JavaScript Date object.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A JavaScript Date object, or null if the input is invalid.
 */
export function toJSDate(timestamp: Timestamp | null | undefined): Date {
  if (!timestamp) {
    return new Date(); // Return current date or a default if input is null/undefined
  }
  if (timestamp instanceof FirebaseTimestamp) {
    return timestamp.toDate();
  }
  // It's already a Date object
  return timestamp;
}

/**
 * Safely converts a custom Timestamp into a localized date string for display.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A formatted date string (e.g., 'YYYY. MM. DD.'), or an empty string.
 */
export function toDisplayDate(timestamp: Timestamp | null | undefined): string {
    if (!timestamp) {
        return '';
    }
    const date = toJSDate(timestamp);
    return date.toLocaleDateString('ko-KR');
}
