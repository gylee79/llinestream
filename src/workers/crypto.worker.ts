
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, Episode } from '@/lib/types';

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type === 'DECRYPT') {
    const { encryptedBuffer, derivedKeyB64, encryption } = event.data.payload;
    
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

      // 2. Extract IV and encrypted data from the buffer
      const { ivLength, tagLength } = encryption;
      const iv = encryptedBuffer.slice(0, ivLength);
      // The authTag is implicitly handled by AES-GCM; we just need to provide the correct tagLength.
      // The encrypted data starts after the IV. The tag is at the end of the ciphertext.
      const encryptedData = encryptedBuffer.slice(ivLength);

      // 3. Decrypt the data
      const decryptedData = await self.crypto.subtle.decrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: tagLength * 8, // a requiremnet of SubtleCrypto's API, in bits
        },
        cryptoKey,
        encryptedData
      );

      // 4. Send the decrypted data back to the main thread
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
