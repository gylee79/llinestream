/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

// --- Start of Browser-native Buffer replacements ---

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = self.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function stringToUint8Array(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

// --- End of Buffer replacements ---

async function importKey(derivedKeyB64: string): Promise<CryptoKey> {
    const keyBuffer = base64ToUint8Array(derivedKeyB64);
    return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
}

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
    const { type, payload } = event.data as any;

    if (type !== 'DECRYPT_CHUNK') {
        return;
    }

    const { requestId, encryptedBuffer, derivedKeyB64, encryption } = payload;
    if (!requestId || !encryptedBuffer || !derivedKeyB64 || !encryption) {
        const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { requestId, message: 'Worker received incomplete data for decryption.', code: 'UNKNOWN_WORKER_ERROR' },
        };
        self.postMessage(response);
        return;
    }

    try {
        const key = await importKey(derivedKeyB64);
        const decryptedChunks: Uint8Array[] = [];
        const dataView = new DataView(encryptedBuffer);
        let currentOffset = 0;
        let chunkIndex = 0;

        while (currentOffset < encryptedBuffer.byteLength) {
            if (currentOffset + 4 > encryptedBuffer.byteLength) {
                if (currentOffset !== encryptedBuffer.byteLength) {
                    console.warn(`Worker: Trailing data found at end of buffer (${encryptedBuffer.byteLength - currentOffset} bytes). Ignoring.`);
                }
                break;
            }
            const chunkBodyLength = dataView.getUint32(currentOffset, false);
            currentOffset += 4;
            
            if (chunkBodyLength === 0) {
                 console.warn("Worker: Found a chunk with zero length, stopping file processing.");
                 break;
            }
            
            if (currentOffset + chunkBodyLength > encryptedBuffer.byteLength) {
                throw new Error(`Integrity error: Chunk ${chunkIndex} overflows buffer. Expected ${chunkBodyLength} bytes, but only ${encryptedBuffer.byteLength - currentOffset} remain.`);
            }

            const chunkBody = encryptedBuffer.slice(currentOffset, currentOffset + chunkBodyLength);
            currentOffset += chunkBodyLength;

            const iv = chunkBody.slice(0, encryption.ivLength);
            const authTag = chunkBody.slice(chunkBody.byteLength - encryption.tagLength);
            const ciphertext = chunkBody.slice(encryption.ivLength, chunkBody.byteLength - encryption.tagLength);

            const aad = stringToUint8Array(`chunk-index:${chunkIndex}`);

            const decryptedChunk = await self.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, tagLength: encryption.tagLength * 8, additionalData: aad },
                key,
                ciphertext
            );
            
            decryptedChunks.push(new Uint8Array(decryptedChunk));
            chunkIndex++;
        }

        if (decryptedChunks.length === 0) {
            throw new Error("Decryption produced no data. The input file might be empty or corrupt.");
        }

        const finalDecryptedBuffer = concatUint8Arrays(decryptedChunks).buffer;

        const response: CryptoWorkerResponse = {
            type: 'DECRYPT_SUCCESS',
            // @ts-ignore
            payload: { requestId, chunkIndex: 0, decryptedChunk: finalDecryptedBuffer },
        };
        // @ts-ignore
        self.postMessage(response, [finalDecryptedBuffer]);

    } catch (error: any) {
        const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { requestId, message: `Decryption failed: ${error.message}`, code: 'INTEGRITY_ERROR' },
        };
        self.postMessage(response);
    }
};

export {};
