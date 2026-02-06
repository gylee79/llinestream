
/**
 * Constructs the public URL for a file in a Firebase Storage bucket.
 * @param bucketName The full name of your Firebase Storage bucket.
 * @param filePath The full path to the file within the bucket.
 * @returns The full public URL to access the file.
 */
export function getPublicUrl(bucketName: string, filePath: string): string {
    if (!bucketName || !filePath) {
      console.error("getPublicUrl: bucketName or filePath is missing.");
      return '';
    }
    const encodedFilePath = encodeURIComponent(filePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedFilePath}?alt=media`;
}
