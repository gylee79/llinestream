
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse } from '@/lib/types';

// PATCH v5.1.7, v5.1.8: Add detailed error handling and key validation.
self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type === 'DECRYPT') {
    const { encryptedBuffer, sessionKey, encryption } = event.data.payload;
    const { ivLength, tagLength } = encryption;

    try {
      // PATCH v5.1.7: Validate session key before any processing.
      if (sessionKey.scope !== 'ONLINE_STREAM_ONLY' && sessionKey.scope !== 'OFFLINE_PLAYBACK') {
        const response: CryptoWorkerResponse = {
            type: 'RECOVERABLE_ERROR',
            payload: { message: '유효하지 않은 키 사용 목적입니다.', code: 'INVALID_SCOPE' }
        };
        self.postMessage(response);
        return;
      }
      if (sessionKey.expiresAt < Date.now()) {
        const response: CryptoWorkerResponse = {
            type: 'RECOVERABLE_ERROR',
            payload: { message: '보안 세션이 만료되었습니다. 재생을 다시 시도합니다.', code: 'KEY_EXPIRED' }
        };
        self.postMessage(response);
        return;
      }
      
      // PATCH v5.1.6: Enforce full buffer assumption (basic check).
      if (!encryptedBuffer || encryptedBuffer.byteLength < (4 + ivLength + tagLength)) {
        throw new Error('Incomplete or empty video buffer received.');
      }

      // 1. Import the derived key for use with AES-GCM
      const keyBuffer = Buffer.from(sessionKey.derivedKeyB64, 'base64');
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
              // PATCH v5.1.8: Fail-fast on malformed stream
              throw new Error(`Integrity error: Incomplete data, not enough bytes for a length header at offset ${offset}.`);
          }
          const lengthBuffer = encryptedBuffer.slice(offset, offset + 4);
          const chunkBodyLength = new DataView(lengthBuffer).getUint32(0, false);
          offset += 4;

          // 2b. Check if the full chunk body is available
          if (offset + chunkBodyLength > encryptedBuffer.byteLength) {
              // PATCH v5.1.8: Fail-fast on malformed stream
              throw new Error(`Integrity error: Corrupted stream. Expected chunk of size ${chunkBodyLength} but only ${encryptedBuffer.byteLength - offset} bytes are available.`);
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
          type: 'DECRYPT_SUCCESS',
          payload: finalPlaintextBuffer,
      };
      self.postMessage(response, [finalPlaintextBuffer.buffer]);

    } catch (error: any) {
      // PATCH v5.1.8: Centralized fatal error handling.
      // DOMException with name 'OperationError' is the typical error for an AuthTag mismatch in Web Crypto.
      const isIntegrityError = error.name === 'OperationError';
      const message = isIntegrityError
          ? '암호화된 비디오 데이터의 무결성 검증에 실패했습니다. 파일이 손상되었거나 변조되었을 수 있습니다.'
          : `복호화 중 치명적인 오류 발생: ${error.message}`;

      const response: CryptoWorkerResponse = {
        type: 'FATAL_ERROR',
        payload: { message, code: isIntegrityError ? 'INTEGRITY_ERROR' : 'DECRYPT_FAILED' },
      };
      self.postMessage(response);
    }
  }
};

// This export is needed to satisfy the module system, even though it's a worker.
export {};
