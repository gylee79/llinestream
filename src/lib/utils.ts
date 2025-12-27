import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
  }).format(price);
}

/**
 * Sanitizes data by deep copying it through JSON stringification and parsing.
 * This process removes any non-plain objects, such as class instances or Firestore Timestamps,
 * making the data safe to pass to Next.js Server Actions.
 * @param data The data to sanitize.
 * @returns A sanitized, plain JavaScript object.
 */
export function sanitize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

/**
 * Constructs the public URL for a file in a Google Cloud Storage bucket.
 * @param bucketName The name of your Firebase Storage bucket (e.g., 'your-project-id.appspot.com').
 * @param filePath The full path to the file within the bucket (e.g., 'images/profile.jpg').
 * @returns The full public URL to access the file.
 */
export function getPublicUrl(bucketName: string, filePath: string): string {
    // Encode the file path to handle special characters
    const encodedFilePath = encodeURIComponent(filePath);
    return `https://storage.googleapis.com/${bucketName}/${filePath}`;
}
