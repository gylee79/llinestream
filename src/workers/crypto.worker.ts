
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

const handleDecrypt = async (payload: Extract<CryptoWorkerRequest, { type: 'DECRYPT' }>['payload']) => {
    const { encryptedBuffer, derivedKeyB64, encryption } = payload;

    try {
        const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
        const cryptoKey = await self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

        const iv = encryptedBuffer.slice(0, encryption.ivLength);
        const ciphertextWithTag = encryptedBuffer.slice(encryption.ivLength);

        const decryptedChunk = await self.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: encryption.tagLength * 8 },
            cryptoKey,
            ciphertextWithTag
        );
        
        const response: CryptoWorkerResponse = {
            type: 'DECRYPT_SUCCESS',
            payload: decryptedChunk,
        };
        // @ts-ignore
        self.postMessage(response, [decryptedChunk]);

    } catch (error: any) {
        const response: CryptoWorkerResponse = {
            type: 'DECRYPT_ERROR',
            payload: {
                message: `복호화 실패: ${error.message}. 파일이 손상되었거나 키가 잘못되었을 수 있습니다.`
            },
        };
        self.postMessage(response);
    }
};


self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
    const { type, payload } = event.data;

    if (type === 'DECRYPT') {
        handleDecrypt(payload);
    }
};

export {};
