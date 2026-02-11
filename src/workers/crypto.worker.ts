
/// <reference lib="webworker" />

import type { CryptoWorkerRequest, CryptoWorkerResponse } from '@/lib/types';

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
  console.log('[Worker] Using AES-GCM with tagLength: 128 bits');
  return self.crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
};

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
    const cryptoKey = await importKey(keyBuffer.buffer);
    
    // Structure: [IV (12 bytes)][Ciphertext + AuthTag]
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
    
    // Enhanced init segment validation
    let validationLog = '';
    if (requestId.endsWith('-0')) { // Assuming the init segment request ID is unique
        const segmentText = new TextDecoder().decode(decryptedSegment.slice(0, 512));
        const hasFtyp = segmentText.includes('ftyp');
        const hasMoov = segmentText.includes('moov');
        validationLog = ` | Init Segment Validation: ftyp=${hasFtyp}, moov=${hasMoov}`;
    }
    
    console.log(`[Worker] ✅ Decryption success for requestId ${requestId}. First 8 bytes (hex): ${hexPreview}${validationLog}`);


    const response: CryptoWorkerResponse = {
      type: 'DECRYPT_SUCCESS',
      payload: { requestId, decryptedSegment },
    };
    
    self.postMessage(response, [decryptedSegment]);

  } catch (error: any) {
    console.error(`[Worker] ❌ Decryption failed for requestId ${requestId}:`, error);
    console.error('[Worker] ❌ Decryption Error Name:', error.name);
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
