'use client';

import {
    FirebaseStorage,
    ref,
    uploadBytesResumable,
    getDownloadURL,
    UploadTask,
} from 'firebase/storage';

interface UploadResult {
    downloadUrl: string;
    filePath: string;
}

export function uploadFile(
    storage: FirebaseStorage,
    path: string,
    file: File,
    onProgress: (progress: number) => void
): Promise<UploadResult> {

    return new Promise((resolve, reject) => {
        const storageRef = ref(storage, path);
        const uploadTask: UploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on(
            'state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                onProgress(progress);
            },
            (error) => {
                console.error("Upload failed:", error);
                reject(new Error(`파일 업로드 실패: ${error.message}`));
            },
            async () => {
                try {
                    const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                    resolve({
                        downloadUrl,
                        filePath: path,
                    });
                } catch (error: any) {
                     console.error("Failed to get download URL:", error);
                     reject(new Error(`다운로드 URL 가져오기 실패: ${error.message}`));
                }
            }
        );
    });
}
