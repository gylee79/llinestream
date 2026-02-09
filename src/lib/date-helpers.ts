
import type { Timestamp } from '@/lib/types';
import { Timestamp as FirebaseTimestamp } from 'firebase/firestore';

/**
 * Safely converts a custom Timestamp (which can be a Firestore Timestamp or a JS Date)
 * into a JavaScript Date object.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A JavaScript Date object, or null if the input is invalid.
 */
export function toJSDate(timestamp: any): Date | null {
  if (!timestamp) {
    return null;
  }
  // This handles both firebase/firestore and firebase-admin Timestamps,
  // as well as JS Date objects, by checking for the toDate method.
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  // If it's not a recognizable timestamp or Date format, return null.
  // This safely handles cases like serverTimestamp() placeholders (FieldValue)
  // without causing a ReferenceError.
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
    const date = toJSDate(timestamp);
    if (!date) {
        return '처리중...'; // Or some other placeholder for server-generated timestamps
    }
    return date.toLocaleDateString('ko-KR');
}

/**
 * Safely converts a custom Timestamp into a localized date and time string for display.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A formatted date and time string (e.g., 'YYYY. MM. DD. HH:mm:ss'), or an empty string.
 */
export function toDisplayDateTime(timestamp: Timestamp | Date | null | undefined): string {
    if (!timestamp) {
        return '';
    }
    const date = toJSDate(timestamp);
    if (!date) {
        return '처리중...';
    }
    // Using options for toLocaleString to get the desired format without manual padding
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false, // Use 24-hour format
    }).format(date).replace(/\. /g, '.').replace(/\.$/, ''); // Tidy up the format
}

/**
 * Safely converts a custom Timestamp into a localized time string for display.
 * @param timestamp The Timestamp or Date to convert.
 * @returns A formatted time string (e.g., 'HH:mm:ss'), or an empty string.
 */
export function toDisplayTime(timestamp: Timestamp | Date | null | undefined): string {
    if (!timestamp) {
        return '';
    }
    const date = toJSDate(timestamp);
    if (!date) {
        return '처리중...';
    }
    return new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
}

