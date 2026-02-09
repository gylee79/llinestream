'use client';

import type { OfflineVideoData, OfflineVideoInfo, OfflineLicense } from './types';

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
  if (navigator.storage && navigator.storage.estimate) {
    const { quota, usage } = await navigator.storage.estimate();
    const availableSpace = (quota || 0) - (usage || 0);
    const requiredSpace = data.encryptedVideo.byteLength;

    if (availableSpace < requiredSpace) {
      throw new Error(
        `저장 공간이 부족합니다. (필요: ${(requiredSpace / 1024 / 1024).toFixed(1)}MB, 사용 가능: ${(
          availableSpace / 1024 / 1024
        ).toFixed(1)}MB)`
      );
    }
  }

  const dbInstance = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(data);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('비디오 저장에 실패했습니다.'));
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

export const updateLicenseCheckTime = async (episodeId: string): Promise<void> => {
  const dbInstance = await initDB();
  const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  
  const getRequest = store.get(episodeId);

  return new Promise((resolve, reject) => {
    getRequest.onerror = () => reject(new Error("라이선스 업데이트 실패: 비디오를 찾을 수 없습니다."));
    getRequest.onsuccess = () => {
      const data = getRequest.result as OfflineVideoData | undefined;
      if (data) {
        data.license.lastCheckedAt = Date.now();
        const putRequest = store.put(data);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(new Error("라이선스 마지막 확인 시간 업데이트에 실패했습니다."));
      } else {
        reject(new Error("라이선스 업데이트 실패: 데이터가 없습니다."));
      }
    };
  });
};

    