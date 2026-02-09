/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

// v5.3 FINAL: This worker now handles both online streaming and offline playback.
// It is designed to be stateless regarding individual requests but holds state for the active stream.

interface StreamContext {
    requestId: string;
    key: CryptoKey;
    encryption: Episode['encryption'];
    offsetMap: { byteStart: number; byteEnd: number }[];
    source: 'ONLINE' | 'OFFLINE';
    signedUrl?: string; // For online streaming
    encryptedBuffer?: ArrayBuffer; // For offline playback
}

let activeStream: StreamContext | null = null;
let abortController: AbortController | null = null;

async function importKey(derivedKeyB64: string): Promise<CryptoKey> {
    const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
    return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
}

// v5.2: Generates an offset map from the first few KB of the file.
async function createOffsetMap(source: 'ONLINE' | 'OFFLINE', encryption: Episode['encryption'], signedUrl?: string, fullBuffer?: ArrayBuffer): Promise<{ byteStart: number; byteEnd: number }[]> {
    const CHUNK_HEADER_SIZE = 4; // 4 bytes for UInt32 BE length
    const MAX_HEADER_READ = 10 * 1024 * 1024; // Read up to 10MB for headers, should be enough.
    
    let buffer: ArrayBuffer;
    if (source === 'OFFLINE' && fullBuffer) {
        buffer = fullBuffer;
    } else if (source === 'ONLINE' && signedUrl) {
        const response = await fetch(signedUrl, { headers: { 'Range': `bytes=0-${MAX_HEADER_READ - 1}` } });
        if (!response.ok) throw new Error('Failed to fetch video headers to create offset map.');
        buffer = await response.arrayBuffer();
    } else {
        throw new Error('Invalid source for offset map creation.');
    }

    const dataView = new DataView(buffer);
    const offsets: { byteStart: number; byteEnd: number }[] = [];
    let currentOffset = 0;

    while (currentOffset + CHUNK_HEADER_SIZE <= dataView.byteLength) {
        const chunkBodyLength = dataView.getUint32(currentOffset, false); // Big Endian
        const chunkTotalLength = CHUNK_HEADER_SIZE + chunkBodyLength;
        
        if (chunkBodyLength === 0) { // Should not happen in a valid file
             console.warn("Found a chunk with zero length, stopping map creation.");
             break;
        }

        offsets.push({
            byteStart: currentOffset,
            byteEnd: currentOffset + chunkTotalLength - 1
        });
        currentOffset += chunkTotalLength;

        // If the next chunk header would be out of bounds of the *downloaded header data*, break.
        if (currentOffset + CHUNK_HEADER_SIZE > dataView.byteLength) {
            break;
        }
    }
    
    if (offsets.length === 0) {
        throw new Error("Could not parse any chunks from the video header. The file might be corrupt.");
    }
    
    return offsets;
}

// Handles online stream initialization
const handleInitOnline = async (payload: Extract<CryptoWorkerRequest, { type: 'INIT_ONLINE_STREAM' }>['payload']) => {
    try {
        if (payload.sessionKey.scope !== 'ONLINE_STREAM_ONLY') {
            throw new Error(`Invalid key scope. Expected 'ONLINE_STREAM_ONLY', got '${payload.sessionKey.scope}'`);
        }
        const key = await importKey(payload.sessionKey.derivedKeyB64);
        const offsetMap = await createOffsetMap('ONLINE', payload.encryption, payload.signedUrl);

        activeStream = {
            requestId: payload.requestId,
            key,
            encryption: payload.encryption,
            offsetMap,
            source: 'ONLINE',
            signedUrl: payload.signedUrl,
        };

        const response: CryptoWorkerResponse = { type: 'INIT_SUCCESS', payload: { requestId: payload.requestId, offsetMap } };
        self.postMessage(response);
    } catch (error: any) {
        const response: CryptoWorkerResponse = { type: 'FATAL_ERROR', payload: { requestId: payload.requestId, message: error.message, code: 'OFFSET_MAP_FAILED' } };
        self.postMessage(response);
    }
};

// Handles offline playback initialization
const handleInitOffline = async (payload: Extract<CryptoWorkerRequest, { type: 'INIT_OFFLINE_PLAYBACK' }>['payload']) => {
    try {
         if (payload.license.scope !== 'OFFLINE_PLAYBACK') {
            throw new Error(`Invalid key scope. Expected 'OFFLINE_PLAYBACK', got '${payload.license.scope}'`);
        }
        const key = await importKey(payload.license.offlineDerivedKey);
        const offsetMap = await createOffsetMap('OFFLINE', payload.encryption, undefined, payload.encryptedBuffer);

        activeStream = {
            requestId: payload.requestId,
            key,
            encryption: payload.encryption,
            offsetMap,
            source: 'OFFLINE',
            encryptedBuffer: payload.encryptedBuffer,
        };

        const response: CryptoWorkerResponse = { type: 'INIT_SUCCESS', payload: { requestId: payload.requestId, offsetMap } };
        self.postMessage(response);
    } catch (error: any) {
        const response: CryptoWorkerResponse = { type: 'FATAL_ERROR', payload: { requestId: payload.requestId, message: error.message, code: 'OFFSET_MAP_FAILED' } };
        self.postMessage(response);
    }
};


// Main decryption logic for a single chunk
const handleDecryptChunk = async (payload: Extract<CryptoWorkerRequest, { type: 'DECRYPT_CHUNK' }>['payload']) => {
    const { requestId, chunkIndex } = payload;
    if (!activeStream || activeStream.requestId !== requestId) return; // Stale request

    const { key, encryption, offsetMap, source, signedUrl, encryptedBuffer } = activeStream;
    const chunkMeta = offsetMap[chunkIndex];
    if (!chunkMeta) {
        self.postMessage({ type: 'FATAL_ERROR', payload: { requestId, message: `Invalid chunk index ${chunkIndex}`, code: 'UNKNOWN_WORKER_ERROR' }});
        return;
    }

    try {
        let chunkData: ArrayBuffer;

        if (source === 'OFFLINE' && encryptedBuffer) {
            chunkData = encryptedBuffer.slice(chunkMeta.byteStart, chunkMeta.byteEnd + 1);
        } else if (source === 'ONLINE' && signedUrl) {
            abortController = new AbortController();
            const response = await fetch(signedUrl, {
                headers: { 'Range': `bytes=${chunkMeta.byteStart}-${chunkMeta.byteEnd}` },
                signal: abortController.signal,
            });
            if (!response.ok) throw new Error(`Network error fetching chunk ${chunkIndex}: ${response.status}`);
            chunkData = await response.arrayBuffer();
        } else {
            throw new Error('Invalid stream source or missing data.');
        }

        const dataView = new DataView(chunkData);
        const chunkBodyLength = dataView.getUint32(0, false); // 4-byte length header
        const encryptedChunkBlob = chunkData.slice(4);

        if (encryptedChunkBlob.byteLength !== chunkBodyLength) {
            throw new Error(`Integrity error: Chunk ${chunkIndex} expected length ${chunkBodyLength} but got ${encryptedChunkBlob.byteLength}.`);
        }

        const iv = encryptedChunkBlob.slice(0, encryption.ivLength);
        const ciphertextWithTag = encryptedChunkBlob.slice(encryption.ivLength);
        const aad = Buffer.from(`chunk-index:${chunkIndex}`);

        const decryptedChunk = await self.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: encryption.tagLength * 8, additionalData: aad },
            key,
            ciphertextWithTag
        );

        const response: CryptoWorkerResponse = { type: 'DECRYPT_SUCCESS', payload: { requestId, chunkIndex, decryptedChunk } };
        // @ts-ignore - Transferable object
        self.postMessage(response, [decryptedChunk]);

    } catch (error: any) {
        if (error.name === 'AbortError') {
             console.log(`Request for chunk ${chunkIndex} was aborted.`);
             return; // Don't send an error message for intentional aborts
        }
        // v5.2.3: Chunk-level partial recovery
        const response: CryptoWorkerResponse = {
            type: 'RECOVERABLE_ERROR',
            payload: {
                requestId,
                chunkIndex,
                message: `Failed to decrypt chunk ${chunkIndex}: ${error.message}. Retrying...`,
                code: 'CHUNK_DECRYPT_FAILED',
            }
        };
        self.postMessage(response);
    }
};

const handleAbort = (payload: Extract<CryptoWorkerRequest, { type: 'ABORT' }>['payload']) => {
    if (activeStream && activeStream.requestId === payload.requestId) {
        abortController?.abort();
        activeStream = null;
    }
}


self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
    const { type, payload } = event.data;

    switch(type) {
        case 'INIT_ONLINE_STREAM':
            handleInitOnline(payload);
            break;
        case 'INIT_OFFLINE_PLAYBACK':
            handleInitOffline(payload);
            break;
        case 'DECRYPT_CHUNK':
            handleDecryptChunk(payload);
            break;
        case 'ABORT':
            handleAbort(payload);
            break;
    }
};

export {};

    