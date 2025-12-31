
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { extractPathFromUrl } from '../utils';
import { googleAI, fileManager } from '@/lib/google-ai';
import { FileState } from '@google/generative-ai/files';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Splits text into chunks of a specified size.
 * @param text The full text to chunk.
 * @param chunkSize The approximate size of each chunk.
 * @returns An array of text chunks.
 */
function chunkText(text: string, chunkSize = 500): string[] {
  const chunks: string[] = [];
  let remainingText = text;
  while (remainingText.length > 0) {
    if (remainingText.length <= chunkSize) {
      chunks.push(remainingText);
      break;
    }
    let chunk = remainingText.substring(0, chunkSize);
    // Try to break at a natural point
    let lastBreak = chunk.lastIndexOf('.') > 0 ? chunk.lastIndexOf('.') : chunk.lastIndexOf(' ');
    if (lastBreak > 0) {
      chunk = chunk.substring(0, lastBreak + 1);
    }
    chunks.push(chunk);
    remainingText = remainingText.substring(chunk.length);
  }
  return chunks;
}


export async function extractScriptWithGemini(episodeId: string, fileUrl: string): Promise<{ success: boolean; message: string; transcript?: string }> {
  if (!process.env.GEMINI_API_KEY) {
      return { success: false, message: 'GEMINI_API_KEY is not configured on the server.' };
  }
  console.log(`[Gemini-Process] Starting video processing for episode: ${episodeId}`);

  let tempVideoPath = '';
  
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const bucket = storage.bucket();

    const videoPath = extractPathFromUrl(fileUrl);
    if (!videoPath) {
      throw new Error('Could not determine video path from URL.');
    }
    console.log(`[Gemini-Process] Found video path: ${videoPath}`);

    // 1. Download video file
    tempVideoPath = path.join(os.tmpdir(), `video_${episodeId}_${Date.now()}.mp4`);
    console.log(`[Gemini-Process] Downloading video to ${tempVideoPath}`);
    await bucket.file(videoPath).download({ destination: tempVideoPath });
    console.log(`[Gemini-Process] Download complete.`);

    // 2. Upload to Google AI File API
    console.log(`[Gemini-Process] Uploading file to Google AI File API...`);
    const uploadResult = await fileManager.uploadFile(tempVideoPath, {
      mimeType: 'video/mp4',
      displayName: `episode-${episodeId}`,
    });
    console.log(`[Gemini-Process] File uploaded. URI: ${uploadResult.file.uri}`);
    
    // 3. Wait for the file to be processed
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === FileState.PROCESSING) {
      console.log('[Gemini-Process] File is processing, waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    if (file.state !== FileState.ACTIVE) {
        throw new Error(`File processing failed. Final state: ${file.state}`);
    }
    console.log('[Gemini-Process] File is ACTIVE. Proceeding with transcription.');

    // 4. Transcribe using Gemini 1.5 Flash
    const model = googleAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = "이 오디오 파일의 내용을 빠짐없이 정확하게 전체 텍스트로 받아 적어줘(Transcribe). 타임스탬프는 필요 없어.";

    const result = await model.generateContent([prompt, { fileData: { mimeType: file.mimeType, fileUri: file.uri } }]);
    const transcriptText = result.response.text();
    
    if (!transcriptText) {
        throw new Error('Transcription returned no text.');
    }
    console.log(`[Gemini-Process] Transcription successful. Length: ${transcriptText.length}`);

    // 5. Save data to Firestore
    const episodeRef = db.collection('episodes').doc(episodeId);
    
    // Save full transcript
    await episodeRef.update({ transcript: transcriptText });
    console.log(`[Gemini-Process] Full transcript saved to Firestore.`);

    // Chunk and save to subcollection
    const chunks = chunkText(transcriptText);
    const batch = db.batch();
    const chunkCollectionRef = episodeRef.collection('chunks');
    
    // Optional: Delete old chunks before adding new ones
    const oldChunks = await chunkCollectionRef.listDocuments();
    oldChunks.forEach(doc => batch.delete(doc));

    chunks.forEach((text, i) => {
        const chunkDocRef = chunkCollectionRef.doc();
        batch.set(chunkDocRef, {
            text: text,
            // startTime is a placeholder, as Gemini doesn't provide timestamps for this type of transcription.
            startTime: i * 30, // Approximate start time
        });
    });
    
    await batch.commit();
    console.log(`[Gemini-Process] Saved ${chunks.length} chunks to Firestore.`);

    return { success: true, message: 'Video processed successfully with Gemini.', transcript: transcriptText };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[Gemini-Process-ERROR]', error);
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  } finally {
      // Clean up temporary file
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
        console.log(`[Gemini-Process] Cleaned up temporary file: ${tempVideoPath}`);
      }
  }
}
