'use client';

import type { OfflineVideoData, OfflineVideoInfo, VideoManifest } from './types';
import { getSignedUrl as getSignedUrlAction } from '@/lib/actions/get-signed-url';
import { getAuth } from 'firebase/auth';

const DB_NAME = 'LlineStreamOffline';
const DB_VERSION = 2; // Increment version for schema change
const VIDEOS_STORE = 'videos';
const SEGMENTS_STORE = 'segments';

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
      if (!dbInstance.objectStoreNames.contains(VIDEOS_STORE)) {
        dbInstance.createObjectStore(VIDEOS_STORE, { keyPath: 'episode.id' });
      }
      if (!dbInstance.objectStoreNames.contains(SEGMENTS_STORE)) {
        // Segments are stored with a key: `${episodeId}-${segmentPath}`
        dbInstance.createObjectStore(SEGMENTS_STORE);
      }
    };
  });
};

export const saveVideo = async (data: OfflineVideoData): Promise<void> => {
    const dbInstance = await initDB();

    // 1. Save metadata (everything except the segments map) to the 'videos' store.
    const metadataToSave = {
        episode: data.episode,
        courseName: data.courseName,
        downloadedAt: data.downloadedAt,
        license: data.license,
        manifest: data.manifest,
    };
    
    const metaTransaction = dbInstance.transaction(VIDEOS_STORE, 'readwrite');
    const metaStore = metaTransaction.objectStore(VIDEOS_STORE);
    metaStore.put(metadataToSave);

    await new Promise<void>((resolve, reject) => {
        metaTransaction.oncomplete = () => resolve();
        metaTransaction.onerror = (e) => reject(new Error('메타데이터 저장에 실패했습니다: ' + (e.target as any)?.error?.message));
    });
    
    // 2. Fetch and store all segments in parallel batches.
    const segmentPaths = [data.manifest.init, ...data.manifest.segments.map(s => s.path)];
    const concurrencyLimit = 5;

    for (let i = 0; i < segmentPaths.length; i += concurrencyLimit) {
        const batchPaths = segmentPaths.slice(i, i + concurrencyLimit);

        // Download a batch of segments in parallel.
        const downloadedSegments = await Promise.all(batchPaths.map(async (path) => {
            const auth = getAuth();
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Authentication token not found.");
            
            const { signedUrl, error } = await getSignedUrlAction(token, data.episode.id, path);
            if (error || !signedUrl) throw new Error(error || "Failed to get signed URL for segment.");

            const response = await fetch(signedUrl);
            if (!response.ok) throw new Error(`Failed to fetch segment: ${response.statusText}`);
            const segmentBuffer = await response.arrayBuffer();
            
            // Key format is crucial for retrieval and deletion.
            return { key: `${data.episode.id}-${path}`, value: segmentBuffer };
        }));

        // Save the downloaded batch to the 'segments' store in a single transaction.
        const segmentTransaction = dbInstance.transaction(SEGMENTS_STORE, 'readwrite');
        const segmentStore = segmentTransaction.objectStore(SEGMENTS_STORE);
        downloadedSegments.forEach(segment => {
            segmentStore.put(segment.value, segment.key);
        });

        await new Promise<void>((resolve, reject) => {
            segmentTransaction.oncomplete = () => resolve();
            segmentTransaction.onerror = (e) => reject(new Error('세그먼트 저장에 실패했습니다: ' + (e.target as any)?.error?.message));
        });
    }
};

export const getDownloadedVideo = async (episodeId: string): Promise<OfflineVideoData | null> => {
  const dbInstance = await initDB();

  // 1. Get the metadata object from the 'videos' store.
  const metadata: Omit<OfflineVideoData, 'segments'> | null = await new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(VIDEOS_STORE, 'readonly');
    const store = transaction.objectStore(VIDEOS_STORE);
    const request = store.get(episodeId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(new Error('메타데이터를 불러오는 데 실패했습니다: ' + (e.target as any)?.error?.message));
  });

  if (!metadata) {
    return null;
  }

  // 2. Efficiently fetch all segments for the episode using a cursor and key range.
  const segments = new Map<string, ArrayBuffer>();
  const keyRange = IDBKeyRange.bound(`${episodeId}-`, `${episodeId}-~`); // '~' is a high Unicode character

  await new Promise<void>((resolve, reject) => {
      const transaction = dbInstance.transaction(SEGMENTS_STORE, 'readonly');
      const store = transaction.objectStore(SEGMENTS_STORE);
      const request = store.openCursor(keyRange);

      request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
              const fullKey = cursor.key as string;
              // Extract the original path from the compound key.
              const path = fullKey.substring(episodeId.length + 1);
              segments.set(path, cursor.value);
              cursor.continue();
          } else {
              resolve(); // Cursor finished.
          }
      };
      request.onerror = (e) => reject(new Error('세그먼트를 불러오는 중 오류가 발생했습니다: ' + (e.target as any)?.error?.message));
  });

  // 3. Combine metadata and segments into the expected data structure for the player.
  return { ...metadata, segments };
};

export const listDownloadedVideos = async (): Promise<OfflineVideoInfo[]> => {
  const dbInstance = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction(VIDEOS_STORE, 'readonly');
    const store = transaction.objectStore(VIDEOS_STORE);
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
    request.onerror = (e) => reject(new Error('다운로드 목록을 불러오는 데 실패했습니다: ' + (e.target as any)?.error?.message));
  });
};

export const deleteVideo = async (episodeId: string): Promise<void> => {
    const dbInstance = await initDB();

    // Use a single transaction to delete from both stores.
    const transaction = dbInstance.transaction([VIDEOS_STORE, SEGMENTS_STORE], 'readwrite');
    
    // 1. Delete metadata from 'videos' store.
    transaction.objectStore(VIDEOS_STORE).delete(episodeId);

    // 2. Delete all segments from 'segments' store using a key range.
    const keyRange = IDBKeyRange.bound(`${episodeId}-`, `${episodeId}-~`);
    transaction.objectStore(SEGMENTS_STORE).delete(keyRange);

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error('비디오 삭제에 실패했습니다: ' + (e.target as any)?.error?.message));
    });
};

  