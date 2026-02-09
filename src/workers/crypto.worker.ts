
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

// Helper function to build AAD for a chunk
const buildAAD = (episodeId: string, chunkIndex: number, encryptionVersion: number): Buffer => {
    const episodeIdBuffer = Buffer.from(episodeId, 'utf-8');
    const chunkIndexBuffer = Buffer.alloc(4);
    chunkIndexBuffer.writeUInt32BE(chunkIndex, 0);
    const versionBuffer = Buffer.alloc(4);
    versionBuffer.writeUInt32BE(encryptionVersion, 0);
    return Buffer.concat([episodeIdBuffer, chunkIndexBuffer, versionBuffer]);
};

// Global state for the worker instance
let cryptoKey: CryptoKey | null = null;
let encryptionInfo: Episode['encryption'] | null = null;
let episodeId: string | null = null;
let signedUrl: string | null = null;
let abortController: AbortController | null = null;

const handleInit = async (payload: CryptoWorkerRequest['payload'] & { type?: 'INIT_STREAM' }) => {
    if (payload.type !== 'INIT_STREAM') return;

    // 1. Reset state
    cryptoKey = null;
    encryptionInfo = null;
    episodeId = null;
    signedUrl = null;
    if (abortController) abortController.abort();
    abortController = new AbortController();

    // 2. Validate Session Key (v5.1.7)
    const { sessionKey } = payload;
    if (sessionKey.scope !== 'ONLINE_STREAM_ONLY') {
        const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { message: '유효하지 않은 키 사용 목적입니다. 온라인 재생에는 온라인 전용 키가 필요합니다.', code: 'INVALID_SCOPE' }
        };
        self.postMessage(response);
        return;
    }
    if (sessionKey.expiresAt < Date.now()) {
        const response: CryptoWorkerResponse = {
            type: 'RECOVERABLE_ERROR',
            payload: { message: '보안 세션이 만료되었습니다.', code: 'KEY_EXPIRED' }
        };
        self.postMessage(response);
        return;
    }
    
    // 3. Import CryptoKey
    const keyBuffer = Buffer.from(sessionKey.derivedKeyB64, 'base64');
    cryptoKey = await self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

    // 4. Store necessary info
    encryptionInfo = payload.encryption;
    episodeId = payload.episodeId;
    signedUrl = payload.signedUrl;

    // 5. Build Chunk Offset Map (v5.2)
    try {
        const response = await fetch(signedUrl, { signal: abortController.signal });
        if (!response.ok || !response.body) {
            throw new Error(`비디오 정보 다운로드 실패 (HTTP ${response.status})`);
        }
        const reader = response.body.getReader();
        const offsetMap: { byteStart: number; byteEnd: number }[] = [];
        let currentOffset = 0;
        let buffer = new Uint8Array();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer = Buffer.concat([buffer, value]);
            
            while (buffer.length >= currentOffset + 4) {
                const chunkBodyLength = new DataView(buffer.buffer, buffer.byteOffset + currentOffset).getUint32(0, false);
                const chunkTotalLength = 4 + chunkBodyLength;
                
                if (buffer.length >= currentOffset + chunkTotalLength) {
                    offsetMap.push({
                        byteStart: currentOffset,
                        byteEnd: currentOffset + chunkTotalLength - 1
                    });
                    currentOffset += chunkTotalLength;
                } else {
                    break; // Not enough data for the full chunk, wait for more
                }
            }
        }
        
        const initSuccessResponse: CryptoWorkerResponse = {
            type: 'INIT_SUCCESS',
            payload: { offsetMap }
        };
        self.postMessage(initSuccessResponse);

    } catch (error: any) {
        const response: CryptoWorkerResponse = {
            type: 'RECOVERABLE_ERROR',
            payload: { message: `초기화 실패: ${error.message}`, code: 'NETWORK_ERROR' }
        };
        self.postMessage(response);
    }
};

const handleDecryptChunk = async (payload: CryptoWorkerRequest['payload'] & { type?: 'DECRYPT_CHUNK' }) => {
    if (payload.type !== 'DECRYPT_CHUNK' || !cryptoKey || !encryptionInfo || !episodeId || !signedUrl) {
        // This shouldn't happen if the main thread logic is correct
        const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { message: 'Worker가 초기화되지 않았거나 정보가 손상되었습니다.', code: 'UNKNOWN_WORKER_ERROR' }
        };
        self.postMessage(response);
        return;
    }
    
    const { chunkIndex } = payload;
    const { offsetMap } = (self as any)._offsetMap; // Assume offsetMap is stored in worker's global scope after init

    if (!offsetMap || chunkIndex >= offsetMap.length) {
         const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { message: `잘못된 청크 인덱스(${chunkIndex})가 요청되었습니다.`, code: 'UNKNOWN_WORKER_ERROR' }
        };
        self.postMessage(response);
        return;
    }

    const { byteStart, byteEnd } = offsetMap[chunkIndex];

    try {
        const rangeResponse = await fetch(signedUrl, {
            headers: { 'Range': `bytes=${byteStart}-${byteEnd}` },
            signal: abortController?.signal
        });

        if (!rangeResponse.ok) {
            throw new Error(`HTTP ${rangeResponse.status}`);
        }
        
        const encryptedChunkWithHeader = await rangeResponse.arrayBuffer();
        
        const chunkBody = encryptedChunkWithHeader.slice(4);
        const iv = chunkBody.slice(0, encryptionInfo.ivLength);
        const ciphertextWithTag = chunkBody.slice(encryptionInfo.ivLength);
        const aad = buildAAD(episodeId, chunkIndex, encryptionInfo.version);
        
        const decryptedChunk = await self.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: encryptionInfo.tagLength * 8, additionalData: aad },
            cryptoKey,
            ciphertextWithTag
        );
        
        const decryptSuccessResponse: CryptoWorkerResponse = {
            type: 'DECRYPT_SUCCESS',
            payload: { chunkIndex, decryptedChunk },
        };
        self.postMessage(decryptSuccessResponse, [decryptedChunk]);

    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log(`Chunk ${chunkIndex} fetch aborted.`);
            return;
        }

        const isIntegrityError = error.name === 'OperationError';
        
        if (isIntegrityError) {
            // v5.1.8: Fail-fast is now a RECOVERABLE error for the chunk, letting main thread decide to retry
             const response: CryptoWorkerResponse = {
                type: 'RECOVERABLE_ERROR',
                payload: {
                    message: `청크 ${chunkIndex}의 무결성 검증에 실패했습니다.`,
                    code: 'CHUNK_DECRYPT_FAILED',
                    chunkIndex
                },
            };
            self.postMessage(response);
        } else {
            // Network errors are recoverable
            const response: CryptoWorkerResponse = {
                type: 'RECOVERABLE_ERROR',
                payload: {
                    message: `청크 ${chunkIndex} 다운로드 실패: ${error.message}`,
                    code: 'NETWORK_ERROR',
                    chunkIndex
                },
            };
            self.postMessage(response);
        }
    }
};

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
    switch (event.data.type) {
        case 'INIT_STREAM':
            // Store offsetMap in a non-standard way for access in other handlers.
            const initResponse = await handleInit(event.data.payload as any);
            if(initResponse && (initResponse as any).type === 'INIT_SUCCESS') {
                 (self as any)._offsetMap = (initResponse as any).payload;
            }
            break;
        case 'DECRYPT_CHUNK':
            await handleDecryptChunk(event.data.payload as any);
            break;
        case 'ABORT':
            if (abortController) {
                abortController.abort();
                abortController = new AbortController(); // Prepare for next operation
            }
            break;
    }
};

export {};

    