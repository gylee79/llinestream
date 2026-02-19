/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse, EncryptionInfo } from '@/lib/types';

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = self.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// --- KEY DERIVATION LOGIC ---
const importHmacKey = (keyBuffer: ArrayBuffer): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
};

const importAesKey = (keyBuffer: ArrayBuffer): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
}

/**
 * Derives a segment-specific AES key from the device-derived key and segment path.
 * This is the second level of key derivation, ensuring each segment has a unique key.
 * @param deviceKey - The HMAC-ready key derived from the master key and deviceId.
 * @param segmentPath - The unique path of the segment, used as info for derivation.
 * @returns A derived CryptoKey for AES-GCM decryption.
 */
const deriveSegmentKey = async (deviceKey: CryptoKey, segmentPath: string): Promise<CryptoKey> => {
    const info = new TextEncoder().encode(segmentPath);
    // Use HMAC-SHA-256 to derive the final segment key.
    const hmac = await self.crypto.subtle.sign('HMAC', deviceKey, info);
    // The derived key is the raw HMAC output.
    return importAesKey(hmac);
};


self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type !== 'DECRYPT_SEGMENT') {
    return;
  }
  
  const { requestId, encryptedSegment, derivedKeyB64, segmentPath, encryption } = event.data.payload;

  if (!encryptedSegment || !derivedKeyB64 || !segmentPath || !encryption) {
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: { requestId, message: 'Incomplete data for decryption (missing segment, key, path, or encryption info).' },
    };
    self.postMessage(response);
    return;
  }
  
  try {
    // 1. Import the device-derived key for HMAC.
    const deviceKeyBuffer = base64ToUint8Array(derivedKeyB64);
    const hmacKey = await importHmacKey(deviceKeyBuffer.buffer as ArrayBuffer);
    
    // 2. Derive the final, segment-specific AES key.
    const segmentAesKey = await deriveSegmentKey(hmacKey, segmentPath);

    // 3. Decrypt using the derived segment key.
    const aad = new TextEncoder().encode(`path:${segmentPath}`);
    const iv = encryptedSegment.slice(0, encryption.ivLength);
    const ciphertextWithTag = encryptedSegment.slice(encryption.ivLength);

    const decryptedSegment = await self.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: encryption.tagLength * 8,
        additionalData: aad,
      },
      segmentAesKey,
      ciphertextWithTag
    );
    
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_SUCCESS',
      payload: { requestId, decryptedSegment },
    };
    
    self.postMessage(response, [decryptedSegment]);

  } catch (error: any) {
    console.error(`[Worker] ❌ Decryption failed for requestId ${requestId}:`, error);
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: {
        requestId,
        message: `Decryption failed in worker: ${error.message}`,
      },
    };
    self.postMessage(response);
  }
};

export {};
