
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type === 'DECRYPT') {
    const { encryptedBuffer, derivedKeyB64, encryption } = event.data.payload;
    const { ivLength, tagLength } = encryption;

    // For debugging structural issues
    console.debug('[CryptoWorker] Received decryption job:', {
      totalLength: encryptedBuffer.byteLength,
      ivLength,
      tagLength,
      expectedCiphertextLength: encryptedBuffer.byteLength - ivLength - tagLength,
    });
    
    try {
      // 1. Basic structure validation
      if (encryptedBuffer.byteLength <= ivLength + tagLength) {
        throw new Error('Invalid encrypted buffer: The provided data is too small to contain a valid IV and authentication tag.');
      }

      // 2. Import the derived key
      const keyBuffer = Buffer.from(derivedKeyB64, 'base64');
      const cryptoKey = await self.crypto.subtle.importKey(
        'raw', 
        keyBuffer, 
        { name: 'AES-GCM' }, 
        false, // extractable: false for security
        ['decrypt']
      );

      // 3. Extract IV and the combined ciphertext + auth tag
      const iv = encryptedBuffer.slice(0, ivLength);
      // The WebCrypto API expects the auth tag to be concatenated at the end of the ciphertext.
      const ciphertextWithTag = encryptedBuffer.slice(ivLength);

      // 4. Decrypt the data
      const decryptedData = await self.crypto.subtle.decrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: tagLength * 8, // tagLength must be in bits for the API
        },
        cryptoKey,
        ciphertextWithTag
      );

      // 5. Send the decrypted data back to the main thread
      const response: CryptoWorkerResponse = {
        type: 'DECRYPT_SUCCESS',
        payload: decryptedData,
      };
      // Transfer the buffer to avoid copying
      self.postMessage(response, [decryptedData]);

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
