
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

const importKey = (keyBuffer: ArrayBuffer): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-256-GCM' }, false, ['decrypt']);
};

self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type !== 'DECRYPT_SEGMENT') {
    return;
  }
  
  const { requestId, encryptedSegment, derivedKeyB64, encryption, storagePath } = event.data.payload;

  if (!encryptedSegment || !derivedKeyB64 || !encryption || !storagePath) {
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: { requestId, message: 'Incomplete data for decryption (missing segment, key, encryption info, or storagePath).' },
    };
    self.postMessage(response);
    return;
  }
  
  try {
    const keyBuffer = base64ToUint8Array(derivedKeyB64);
    const cryptoKey = await importKey(keyBuffer.buffer);

    // From Spec 3 & 6.3: Use the segment's storage path as AAD.
    const aad = new TextEncoder().encode(`path:${storagePath}`);
    
    // From Spec 3: [IV(12)][CIPHERTEXT][TAG(16)]
    const iv = encryptedSegment.slice(0, encryption.ivLength);
    const ciphertextWithTag = encryptedSegment.slice(encryption.ivLength);

    const decryptedSegment = await self.crypto.subtle.decrypt(
      {
        name: 'AES-256-GCM',
        iv: iv,
        tagLength: encryption.tagLength * 8, // Convert bytes to bits
        additionalData: aad, // Add AAD for integrity check
      },
      cryptoKey,
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
