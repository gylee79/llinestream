
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
let activeRequestId: string | null = null;
let cryptoKey: CryptoKey | null = null;
let encryptionInfo: Episode['encryption'] | null = null;
let episodeId: string | null = null;
let signedUrl: string | null = null;

const handleInit = async (payload: Extract<CryptoWorkerRequest, { type: 'INIT_STREAM' }>['payload']) => {
    activeRequestId = payload.requestId;
    cryptoKey = null;
    encryptionInfo = null;
    episodeId = null;
    signedUrl = null;

    try {
        // 1. Validate Session Key (v5.1.7)
        const { sessionKey } = payload;
        if (sessionKey.scope !== 'ONLINE_STREAM_ONLY') {
            throw { code: 'INVALID_SCOPE', message: '온라인 재생에는 온라인 전용 키가 필요합니다.' };
        }
        if (sessionKey.expiresAt < Date.now()) {
            throw { code: 'KEY_EXPIRED', message: '보안 세션이 만료되었습니다.' };
        }
        
        // 2. Import CryptoKey
        const keyBuffer = Buffer.from(sessionKey.derivedKeyB64, 'base64');
        cryptoKey = await self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

        // 3. Store necessary info
        encryptionInfo = payload.encryption;
        episodeId = payload.episodeId;
        signedUrl = payload.signedUrl;

        // 4. Build Chunk Offset Map (v5.2)
        const response = await fetch(signedUrl);
        if (!response.ok || !response.body) {
            throw { code: 'NETWORK_ERROR', message: `비디오 정보 다운로드 실패 (HTTP ${response.status})` };
        }
        const reader = response.body.getReader();
        const offsetMap: { byteStart: number; byteEnd: number }[] = [];
        let currentOffset = 0;
        let buffer = new Uint8Array();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done && buffer.byteLength <= currentOffset) break;

            if (value) buffer = Buffer.concat([buffer, value]);
            
            let moved = false;
            do {
                moved = false;
                if (buffer.length >= currentOffset + 4) {
                    const chunkBodyLength = new DataView(buffer.buffer, buffer.byteOffset + currentOffset).getUint32(0, false);
                    const chunkTotalLength = 4 + chunkBodyLength;
                    
                    if (buffer.length >= currentOffset + chunkTotalLength) {
                        offsetMap.push({
                            byteStart: currentOffset,
                            byteEnd: currentOffset + chunkTotalLength - 1
                        });
                        currentOffset += chunkTotalLength;
                        moved = true;
                    }
                }
            } while(moved);

            if (done) break;
        }
        
        if (payload.requestId !== activeRequestId) return; // Aborted during init

        const initSuccessResponse: CryptoWorkerResponse = {
            type: 'INIT_SUCCESS',
            payload: { requestId: payload.requestId, offsetMap }
        };
        self.postMessage(initSuccessResponse);

    } catch (error: any) {
        if (payload.requestId !== activeRequestId) return;
        const response: CryptoWorkerResponse = {
            type: error.code === 'INVALID_SCOPE' ? 'FATAL_ERROR' : 'RECOVERABLE_ERROR',
            payload: { requestId: payload.requestId, message: `초기화 실패: ${error.message}`, code: error.code || 'NETWORK_ERROR' }
        };
        self.postMessage(response);
    }
};

const handleDecryptChunk = async (payload: Extract<CryptoWorkerRequest, { type: 'DECRYPT_CHUNK' }>['payload']) => {
    if (payload.requestId !== activeRequestId || !cryptoKey || !encryptionInfo || !episodeId || !signedUrl) {
        return; // Stale request or worker not initialized, discard
    }
    
    const { chunkIndex, byteStart, byteEnd } = payload;

    try {
        const rangeResponse = await fetch(signedUrl, { headers: { 'Range': `bytes=${byteStart}-${byteEnd}` } });

        if (!rangeResponse.ok) throw new Error(`HTTP ${rangeResponse.status}`);
        
        const encryptedChunkWithHeader = await rangeResponse.arrayBuffer();
        if (payload.requestId !== activeRequestId) return; // Aborted during fetch
        
        const chunkBody = encryptedChunkWithHeader.slice(4);
        const iv = chunkBody.slice(0, encryptionInfo.ivLength);
        const ciphertextWithTag = chunkBody.slice(encryptionInfo.ivLength);
        const aad = buildAAD(episodeId, chunkIndex, encryptionInfo.version);
        
        const decryptedChunk = await self.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: encryptionInfo.tagLength * 8, additionalData: aad },
            cryptoKey,
            ciphertextWithTag
        );
        
        if (payload.requestId !== activeRequestId) return; // Aborted during decrypt

        const decryptSuccessResponse: CryptoWorkerResponse = {
            type: 'DECRYPT_SUCCESS',
            payload: { requestId: payload.requestId, chunkIndex, decryptedChunk },
        };
        self.postMessage(decryptSuccessResponse, [decryptedChunk]);

    } catch (error: any) {
        if (payload.requestId !== activeRequestId) return;
        
        const isIntegrityError = error.name === 'OperationError';
        const response: CryptoWorkerResponse = {
            type: isIntegrityError ? 'RECOVERABLE_ERROR' : 'FATAL_ERROR',
            payload: {
                requestId: payload.requestId,
                message: isIntegrityError ? `청크 ${chunkIndex} 무결성 검증 실패` : `청크 ${chunkIndex} 다운로드 실패: ${error.message}`,
                code: isIntegrityError ? 'CHUNK_DECRYPT_FAILED' : 'NETWORK_ERROR',
                chunkIndex
            },
        };
        self.postMessage(response);
    }
};

self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
    const { type, payload } = event.data;

    if (type === 'ABORT') {
        if (payload.requestId === activeRequestId) {
            activeRequestId = null;
        }
        return;
    }

    if (payload.requestId !== activeRequestId && type !== 'INIT_STREAM') {
        return; // Discard messages from stale requests
    }

    switch (type) {
        case 'INIT_STREAM':
            handleInit(payload);
            break;
        case 'DECRYPT_CHUNK':
            handleDecryptChunk(payload);
            break;
    }
};

export {};

    