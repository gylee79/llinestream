/// <reference lib="webworker" />

// This worker performs a single, stateless decryption operation.
// It is designed to decrypt one chunk of data at a time, as it receives it.
// This is essential for handling streamed content (e.g., via HTTP Range Requests).

self.onmessage = async (event: MessageEvent) => {
  const { requestId, key, iv, aad, ciphertext, tagLengthBits } = event.data;

  // Basic validation to ensure all necessary parts are present.
  if (!key || !iv || !ciphertext || !tagLengthBits) {
    self.postMessage({
      type: 'FATAL_ERROR',
      payload: { requestId, message: 'Incomplete data received for decryption in worker.', code: 'UNKNOWN_WORKER_ERROR' },
    });
    return;
  }

  try {
    // Perform the decryption using the Web Crypto API.
    // The main thread is responsible for providing the correct, separated parts of the data.
    const decryptedChunk = await self.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        additionalData: aad,
        tagLength: tagLengthBits, // Expecting length in bits, e.g., 128 for a 16-byte tag.
      },
      key,
      ciphertext
    );

    // If successful, send the decrypted data back to the main thread.
    // The decryptedChunk (an ArrayBuffer) is marked as a "transferable object"
    // to pass it efficiently without copying.
    self.postMessage(
      {
        type: 'DECRYPT_SUCCESS',
        payload: { requestId, decryptedChunk },
      },
      [decryptedChunk]
    );

  } catch (error: any) {
    // If decryption fails (e.g., due to a wrong key, corrupted data, or integrity check failure),
    // notify the main thread of the fatal error.
    self.postMessage({
      type: 'FATAL_ERROR',
      payload: {
        requestId,
        message: `Decryption failed in worker: ${error.message}`,
        code: 'INTEGRITY_ERROR',
      },
    });
  }
};

// Required for TS to treat this as a module.
export {};
