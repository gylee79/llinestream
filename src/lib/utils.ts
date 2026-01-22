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

export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '00:00:00';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = remainingSeconds.toString().padStart(2, '0');

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
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
 * Constructs the public URL for a file in a Firebase Storage bucket using the recommended firebasestorage.googleapis.com format.
 * This format works reliably for public files.
 * @param bucketName The full name of your Firebase Storage bucket (e.g., 'your-project-id.appspot.com').
 * @param filePath The full path to the file within the bucket (e.g., 'images/profile.jpg').
 * @returns The full public URL to access the file.
 */
export function getPublicUrl(bucketName: string, filePath: string): string {
    if (!bucketName || !filePath) {
      console.error("getPublicUrl: bucketName or filePath is missing.");
      return '';
    }
    // Encode the file path to handle special characters like spaces or symbols
    const encodedFilePath = encodeURIComponent(filePath);
    
    // Use the standard Firebase Storage URL format
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedFilePath}?alt=media`;
}


/**
 * Extracts the storage path from a full `storage.googleapis.com` or `firebasestorage.googleapis.com` URL.
 * @param url The full public URL of the file.
 * @returns The decoded file path within the bucket (e.g., 'images/profile.jpg'), or undefined if parsing fails.
 */
export function extractPathFromUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const urlObject = new URL(url);
        // Pathname for firebasestorage.googleapis.com is /v0/b/<bucket_name>/o/<path_to_file>?...
        if (urlObject.hostname === 'firebasestorage.googleapis.com') {
             const pathSegments = urlObject.pathname.split('/');
             // Find the 'o' segment, the path is what comes after it
             const oIndex = pathSegments.indexOf('o');
             if (oIndex !== -1 && oIndex + 1 < pathSegments.length) {
                return decodeURIComponent(pathSegments.slice(oIndex + 1).join('/'));
             }
        }
        // Deprecated but handle for old data
        if (urlObject.hostname === 'storage.googleapis.com') {
            const pathSegments = urlObject.pathname.split('/');
            // Remove the initial empty segment and the bucket name segment
            if (pathSegments.length > 2) {
                return decodeURIComponent(pathSegments.slice(2).join('/'));
            }
        }
    } catch (e) {
        console.warn(`Could not parse URL to extract path: ${url}`, e);
    }
    // Return undefined if parsing fails for any reason
    return undefined;
};
