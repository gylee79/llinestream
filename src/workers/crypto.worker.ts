/// <reference lib="webworker" />

// This worker is a stateless chunk decryptor.
// It receives an encrypted chunk and a key, decrypts it, and returns the result.

/**
 * Converts a Base64 string to a Uint8Array.
 * self.atob is used because this is a worker environment.
 */
const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = self.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/**
 * Imports a raw AES-GCM key for use with the Web Crypto API.
 */
const importKey = (keyBuffer: Uint8Array): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
};

// Main message handler for the worker.
self.onmessage = async (event: MessageEvent) => {
  // Worker expects a payload with specific data for decryption.
  // This is part of a larger state machine handled by the main thread.
  if (event.data.type !== 'DECRYPT_CHUNK') {
    return;
  }
  const { requestId, encryptedBuffer, derivedKeyB64, encryption, chunkIndex } = event.data.payload;

  // Validate the incoming data.
  if (!encryptedBuffer || !derivedKeyB64 || !encryption) {
    self.postMessage({
      type: 'FATAL_ERROR',
      payload: { requestId, message: 'Incomplete data for decryption.', code: 'UNKNOWN_WORKER_ERROR' },
    });
    return;
  }

  try {
    // 1. Convert the Base64 key string into a usable CryptoKey.
    const keyBuffer = base64ToUint8Array(derivedKeyB64);
    const cryptoKey = await importKey(keyBuffer);

    // 2. Extract IV and the ciphertext (which includes the auth tag) from the buffer.
    // The buffer structure is: [IV (12 bytes)][Ciphertext (variable)][AuthTag (16 bytes)]
    const iv = encryptedBuffer.slice(0, encryption.ivLength);
    const ciphertextWithTag = encryptedBuffer.slice(encryption.ivLength);
    
    // 3. Recreate the Authenticated-Additional-Data (AAD) for integrity check.
    // This must match the AAD used during encryption.
    const aad = new TextEncoder().encode(`chunk-index:${chunkIndex}`);

    // 4. Decrypt the data. The Web Crypto API handles splitting the tag from the ciphertext internally.
    const decryptedChunk = await self.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        additionalData: aad,
        tagLength: encryption.tagLength * 8, // API expects tag length in bits.
      },
      cryptoKey,
      ciphertextWithTag
    );

    // 5. Send the decrypted data back to the main thread.
    // The ArrayBuffer is marked as "transferable" for performance.
    self.postMessage(
      {
        type: 'DECRYPT_SUCCESS',
        payload: { requestId, chunkIndex, decryptedChunk },
      },
      [decryptedChunk]
    );

  } catch (error: any) {
    // If decryption fails, it's a fatal error for this chunk.
    self.postMessage({
      type: 'FATAL_ERROR',
      payload: {
        requestId,
        message: `Decryption failed in worker for chunk ${chunkIndex}: ${error.message}`,
        code: 'INTEGRITY_ERROR',
      },
    });
  }
};

// Required for TS to treat this as a module.
export {};
