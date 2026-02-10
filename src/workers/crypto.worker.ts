/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

// This worker is now STATELESS. It receives all necessary data in a single message
// and returns the fully decrypted file in a single message.

async function importKey(derivedKeyB64: string): Promise<CryptoKey> {
    const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
    return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
}

// The main message handler.
self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
    // The client sends a 'DECRYPT_CHUNK' message with a non-standard payload.
    // We handle it directly here.
    const { type, payload } = event.data as any; // Use 'any' to accept the client's payload.

    if (type !== 'DECRYPT_CHUNK') {
        // This worker is now specialized for the client's specific request type.
        // Ignore other message types.
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
        const decryptedChunks: Buffer[] = [];
        const dataView = new DataView(encryptedBuffer);
        let currentOffset = 0;
        let chunkIndex = 0;

        while (currentOffset < encryptedBuffer.byteLength) {
            // 1. Read chunk header (4 bytes, Big Endian) to get the length of the body.
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
            
            // 2. Check if we have enough data for the full chunk body.
            if (currentOffset + chunkBodyLength > encryptedBuffer.byteLength) {
                throw new Error(`Integrity error: Chunk ${chunkIndex} overflows buffer. Expected ${chunkBodyLength} bytes, but only ${encryptedBuffer.byteLength - currentOffset} remain.`);
            }

            // 3. Slice the full chunk body from the main buffer.
            const chunkBody = encryptedBuffer.slice(currentOffset, currentOffset + chunkBodyLength);
            currentOffset += chunkBodyLength;

            // 4. Extract IV, ciphertext, and auth tag from the chunk body.
            const iv = chunkBody.slice(0, encryption.ivLength);
            const authTag = chunkBody.slice(chunkBody.byteLength - encryption.tagLength);
            const ciphertext = chunkBody.slice(encryption.ivLength, chunkBody.byteLength - encryption.tagLength);

            // 5. Set Additional Authenticated Data (AAD) for this chunk.
            const aad = Buffer.from(`chunk-index:${chunkIndex}`);

            // 6. Decrypt the ciphertext.
            const decryptedChunk = await self.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, tagLength: encryption.tagLength * 8, additionalData: aad },
                key,
                ciphertext
            );
            
            decryptedChunks.push(Buffer.from(decryptedChunk));
            chunkIndex++;
        }

        if (decryptedChunks.length === 0) {
            throw new Error("Decryption produced no data. The input file might be empty or corrupt.");
        }

        // 7. Concatenate all decrypted chunks into a single buffer.
        const finalDecryptedBuffer = Buffer.concat(decryptedChunks).buffer;

        // 8. Send the final result back to the main thread.
        const response: CryptoWorkerResponse = {
            type: 'DECRYPT_SUCCESS',
            // @ts-ignore - The payload is intentionally structured to match the client's expectation of a single buffer.
            payload: { requestId, chunkIndex: 0, decryptedChunk: finalDecryptedBuffer },
        };
        // @ts-ignore
        self.postMessage(response, [finalDecryptedBuffer]);

    } catch (error: any) {
        // If anything fails (key import, decryption), send a fatal error.
        const response: CryptoWorkerResponse = {
            type: 'FATAL_ERROR',
            payload: { requestId, message: `Decryption failed: ${error.message}`, code: 'INTEGRITY_ERROR' },
        };
        self.postMessage(response);
    }
};

export {};
