'use client';

import type { OfflineVideoData, OfflineVideoInfo, VideoManifest } from './types';
import { getSignedUrl } from '@/lib/actions/get-signed-url';
import { getAuth } from 'firebase/auth';

const DB_NAME = 'LlineStreamOffline';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

let db: IDBDatabase | null = null;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('IndexedDB 열기에 실패했습니다.'));
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'episode.id' });
      }
    };
  });
};

export const saveVideo = async (data: OfflineVideoData): Promise<void> => {
    const dbInstance = await initDB();
    
    // Fetch and store all segments
    const segmentMap = new Map<string, ArrayBuffer>();
    const segmentPaths = [data.manifest.init, ...data.manifest.segments.map(s => s.path)];

    for (const path of segmentPaths) {
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Authentication token not found.");
        
        const { signedUrl, error } = await getSignedUrl(token, data.episode.id, path);
        if (error || !signedUrl) throw new Error(error || "Failed to get signed URL for segment.");

        const response = await fetch(signedUrl);
        const segmentBuffer = await response.arrayBuffer();
        segmentMap.set(path, segmentBuffer);
    }
    
    const dataToSave: OfflineVideoData = {
        ...data,
        segments: segmentMap,
    };

    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(dataToSave);
  
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(new Error('비디오 저장에 실패했습니다: ' + (e.target as any)?.error?.message));
    });
};


export const getDownloadedVideo = async (episodeId: string): Promise<OfflineVideoData | null> => {
  const dbInstance = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(episodeId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('비디오를 불러오는 데 실패했습니다.'));
  });
};

export const listDownloadedVideos = async (): Promise<OfflineVideoInfo[]> => {
  const dbInstance = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const allData: OfflineVideoData[] = request.result;
      const infoList: OfflineVideoInfo[] = allData.map(d => ({
        episodeId: d.episode.id,
        title: d.episode.title,
        courseName: d.courseName,
        thumbnailUrl: d.episode.thumbnailUrl,
        downloadedAt: d.downloadedAt,
        expiresAt: new Date(d.license.expiresAt),
      }));
      resolve(infoList.sort((a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime()));
    };
    request.onerror = () => reject(new Error('다운로드 목록을 불러오는 데 실패했습니다.'));
  });
};

export const deleteVideo = async (episodeId: string): Promise<void> => {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(episodeId);
  
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('비디오 삭제에 실패했습니다.'));
    });
};
