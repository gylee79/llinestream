/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse } from '@/lib/types';

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type === 'DECRYPT') {
    const { encryptedBuffer, derivedKeyB64, encryption } = event.data.payload;
    const { ivLength, tagLength } = encryption;

    try {
      // 1. Import the derived key for use with AES-GCM
      const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
      const cryptoKey = await self.crypto.subtle.importKey(
        'raw', 
        keyBuffer, 
        { name: 'AES-GCM' }, 
        false, // Not extractable for security
        ['decrypt']
      );
      
      const decryptedChunks: ArrayBuffer[] = [];
      let offset = 0;
      let chunkIndex = 0;

      // 2. Loop through the entire buffer, processing one chunk at a time
      while (offset < encryptedBuffer.byteLength) {
          // 2a. Read the chunk length header (4 bytes, Big Endian)
          if (offset + 4 > encryptedBuffer.byteLength) {
              console.warn("CryptoWorker: Incomplete data, not enough bytes for a length header.");
              break;
          }
          const lengthBuffer = encryptedBuffer.slice(offset, offset + 4);
          const chunkBodyLength = new DataView(lengthBuffer).getUint32(0, false);
          offset += 4;

          // 2b. Check if the full chunk body is available
          if (offset + chunkBodyLength > encryptedBuffer.byteLength) {
              throw new Error(`Corrupted stream: expected chunk of size ${chunkBodyLength} but only ${encryptedBuffer.byteLength - offset} bytes are available.`);
          }
          
          // 2c. Extract IV, ciphertext, and AuthTag from the chunk body
          const chunkBody = encryptedBuffer.slice(offset, offset + chunkBodyLength);
          offset += chunkBodyLength;
          
          const iv = chunkBody.slice(0, ivLength);
          const ciphertextWithTag = chunkBody.slice(ivLength);
          
          // 2d. Use the chunk index as Additional Authenticated Data (AAD) for replay/reorder protection
          const aad = Buffer.from(`chunk-index:${chunkIndex++}`);

          // 2e. Decrypt the current chunk
          const decryptedChunk = await self.crypto.subtle.decrypt(
            { 
              name: 'AES-GCM', 
              iv: iv,
              tagLength: tagLength * 8, // tagLength must be in bits
              additionalData: aad
            },
            cryptoKey,
            ciphertextWithTag
          );

          decryptedChunks.push(decryptedChunk);
      }
      
      // 3. Concatenate all decrypted chunks and send back as a single buffer
      const finalPlaintextBuffer = Buffer.concat(decryptedChunks);
      const response: CryptoWorkerResponse = {
          type: 'DECRYPT_COMPLETE',
          payload: finalPlaintextBuffer,
      };
      self.postMessage(response, [finalPlaintextBuffer.buffer]);

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
