
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse } from '@/lib/types';

/**
 * Converts a Base64 string to a Uint8Array.
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
 * Imports a raw AES-GCM key.
 */
const importKey = (keyBuffer: Uint8Array): Promise<CryptoKey> => {
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
};

/**
 * Main message handler for the worker. This worker is stateless.
 * It receives an encrypted segment, decrypts it, and returns the result.
 */
self.onmessage = async (event: MessageEvent<CryptoWorkerRequest>) => {
  if (event.data.type !== 'DECRYPT_SEGMENT') {
    return;
  }
  
  const { requestId, encryptedSegment, derivedKeyB64 } = event.data.payload;

  if (!encryptedSegment || !derivedKeyB64) {
    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_FAILURE',
      payload: { requestId, message: 'Incomplete data for decryption.' },
    };
    self.postMessage(response);
    return;
  }

  try {
    const keyBuffer = base64ToUint8Array(derivedKeyB64);
    const cryptoKey = await importKey(keyBuffer);
    
    // The encrypted segment is structured as: [IV (12 bytes)][Ciphertext + AuthTag (variable)]
    const iv = encryptedSegment.slice(0, 12);
    const ciphertextWithTag = encryptedSegment.slice(12);

    const decryptedSegment = await self.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128, // 16 bytes * 8 bits/byte
      },
      cryptoKey,
      ciphertextWithTag
    );
    
    const hexPreview = Array.from(new Uint8Array(decryptedSegment.slice(0, 8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(`[Worker] ✅ Decryption success for requestId ${requestId}. First 8 bytes (hex): ${hexPreview}`);


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

// Required for TS to treat this as a module.
export {};
