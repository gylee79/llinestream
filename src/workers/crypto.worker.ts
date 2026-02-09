
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type === 'DECRYPT') {
    const { encryptedBuffer, derivedKeyB64, encryption } = event.data.payload;
    const { ivLength, tagLength, chunkSize } = encryption;

    try {
      // 1. Import the derived key
      const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
      const cryptoKey = await self.crypto.subtle.importKey(
        'raw', 
        keyBuffer, 
        { name: 'AES-GCM' }, 
        false, // extractable: false for security
        ['decrypt']
      );

      // 2. Loop through the buffer, decrypting chunk by chunk
      let offset = 0;
      const plaintextChunkSize = chunkSize || (1 * 1024 * 1024); // Default to 1MB if not provided

      while (offset < encryptedBuffer.byteLength) {
          const remainingBytes = encryptedBuffer.byteLength - offset;
          
          // Determine the size of the plaintext for the current chunk
          const currentPlaintextChunkSize = Math.min(plaintextChunkSize, remainingBytes - ivLength - tagLength);
          
          if (currentPlaintextChunkSize <= 0) break; // No more full chunks to process

          const currentEncryptedBlockSize = ivLength + currentPlaintextChunkSize + tagLength;
          
          if (remainingBytes < currentEncryptedBlockSize) {
              throw new Error(`Incomplete chunk data. Remaining: ${remainingBytes}, Expected: ${currentEncryptedBlockSize}`);
          }
          
          const block = encryptedBuffer.slice(offset, offset + currentEncryptedBlockSize);
          
          const iv = block.slice(0, ivLength);
          const ciphertextWithTag = block.slice(ivLength);
          
          // Decrypt the current chunk
          const decryptedChunk = await self.crypto.subtle.decrypt(
            { 
              name: 'AES-GCM', 
              iv: iv,
              tagLength: tagLength * 8, // tagLength must be in bits
            },
            cryptoKey,
            ciphertextWithTag
          );

          // Post each decrypted chunk back to the main thread
          const chunkResponse: CryptoWorkerResponse = {
              type: 'DECRYPT_CHUNK_SUCCESS',
              payload: decryptedChunk,
          };
          self.postMessage(chunkResponse, [decryptedChunk]);

          offset += currentEncryptedBlockSize;
      }
      
      // 3. Signal that decryption is complete
      const completeResponse: CryptoWorkerResponse = { type: 'DECRYPT_COMPLETE', payload: {} };
      self.postMessage(completeResponse);

    } catch (error: any) {
      console.error('CryptoWorker Error:', error);
      const response: CryptoWorkerResponse = {
        type: 'DECRYPT_ERROR',
        payload: { message: `복호화 실패: ${error.message}` },
      };
      self.postMessage(response);
    }
  }
};

// This export is needed to satisfy the module system, even though it's a worker.
export {};

    