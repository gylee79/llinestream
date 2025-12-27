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
 * This version corrects the bucket name if it contains '.firebasestorage.app'.
 * @param bucketName The name of your Firebase Storage bucket (e.g., 'your-project-id.appspot.com').
 * @param filePath The full path to the file within the bucket (e.g., 'images/profile.jpg').
 * @returns The full public URL to access the file.
 */
export function getPublicUrl(bucketName: string, filePath: string): string {
    if (!bucketName) {
      console.error("getPublicUrl: bucketName is missing.");
      // To prevent broken URLs, return an empty string or a placeholder.
      // Returning an empty string will trigger Next.js's invalid src warning, which is helpful for debugging.
      return '';
    }
    // The bucket name for GCS URLs should not contain '.firebasestorage.app'
    const correctBucketName = bucketName.replace('.firebasestorage.app', '');
    
    // Do not encode the full file path, as it may contain directory slashes which should not be encoded.
    // Individual segments of a path should be encoded if they contain special characters,
    // but Firebase SDKs handle this during upload. The stored path is usually safe.
    return `https://storage.googleapis.com/${correctBucketName}/${filePath}`;
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
        // Pathname for storage.googleapis.com is /<bucket_name>/<path_to_file>
        // Pathname for firebasestorage.googleapis.com is /v0/b/<bucket_name>/o/<path_to_file>?...
        if (urlObject.hostname === 'storage.googleapis.com') {
            const pathSegments = urlObject.pathname.split('/');
            // Remove the initial empty segment and the bucket name segment
            if (pathSegments.length > 2) {
                return decodeURIComponent(pathSegments.slice(2).join('/'));
            }
        } else if (urlObject.hostname === 'firebasestorage.googleapis.com') {
             const pathSegments = urlObject.pathname.split('/');
             // Find the 'o' segment, the path is what comes after it
             const oIndex = pathSegments.indexOf('o');
             if (oIndex !== -1 && oIndex + 1 < pathSegments.length) {
                return decodeURIComponent(pathSegments.slice(oIndex + 1).join('/'));
             }
        }
    } catch (e) {
        console.warn(`Could not parse URL to extract path: ${url}`, e);
    }
    // Return undefined if parsing fails for any reason
    return undefined;
};