
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { extractPathFromUrl, getPublicUrl } from '../utils';
import { googleAI, fileManager } from '@/lib/google-ai';
import type { FileState } from '@google/generative-ai/server';
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


export async function extractScriptWithGemini(episodeId: string, fileUrl: string): Promise<{ success: boolean; message: string; transcript?: string; vttUrl?: string; vttPath?: string; }> {
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
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      throw new Error('Firebase Storage bucket name is not configured in environment variables.');
    }
    
    const episodeRef = db.collection('episodes').doc(episodeId);
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });
    
    const videoPath = extractPathFromUrl(fileUrl);
    if (!videoPath) {
        throw new Error('Could not determine video path from URL.');
    }

    const videoFile = bucket.file(videoPath);
    const [videoExists] = await videoFile.exists();
    if (!videoExists) {
        throw new Error(`Video file does not exist in Storage at path: ${videoPath}`);
    }

    // --- Download video to a temporary local file ---
    const tempDir = os.tmpdir();
    tempVideoPath = path.join(tempDir, `episode-${episodeId}-${Date.now()}.mp4`);
    console.log(`[Gemini-Process] Downloading video to temporary path: ${tempVideoPath}`);
    await videoFile.download({ destination: tempVideoPath });
    console.log(`[Gemini-Process] Video downloaded successfully.`);


    // 1. Upload to Google AI File API
    console.log(`[Gemini-Process] Uploading file to Google AI File API from temp path...`);
    const uploadResult = await fileManager.uploadFile(tempVideoPath, {
      mimeType: 'video/mp4',
      displayName: `episode-${episodeId}`,
    });
    console.log(`[Gemini-Process] File uploaded. URI: ${uploadResult.file.uri}`);
    
    // 2. Wait for the file to be processed
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === 'PROCESSING') {
      console.log('[Gemini-Process] File is processing, waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    if (file.state !== 'ACTIVE') {
        throw new Error(`File processing failed. Final state: ${file.state}, Error: ${file.error?.message}`);
    }
    console.log('[Gemini-Process] File is ACTIVE. Proceeding with transcription.');

    // 3. Transcribe using Gemini 1.5 Flash
    const model = googleAI.getGenerativeModel({ model: "gemini-pro-vision" });
    const transcriptionPrompt = "이 오디오 파일의 내용을 빠짐없이 정확하게 전체 텍스트로 받아 적어줘(Transcribe). 타임스탬프는 필요 없어.";
    const vttPrompt = "Transcribe this video file into a WebVTT (VTT) format subtitle file. Ensure accurate timestamps and text. Start with WEBVTT.";

    const [transcriptionResult, vttResult] = await Promise.all([
        model.generateContent([transcriptionPrompt, { fileData: { mimeType: file.mimeType, fileUri: file.uri } }]),
        model.generateContent([vttPrompt, { fileData: { mimeType: file.mimeType, fileUri: file.uri } }]),
    ]);
    
    const transcriptText = transcriptionResult.response.text();
    let vttContent = vttResult.response.text();

    // Clean up VTT content, remove markdown fences
    vttContent = vttContent.replace(/^```vtt\n/,'').replace(/```$/, '');

    if (!transcriptText || !vttContent) {
        throw new Error('Transcription or VTT generation returned no text.');
    }
    console.log(`[Gemini-Process] Transcription successful. Length: ${transcriptText.length}`);
    console.log(`[Gemini-Process] VTT generation successful. Length: ${vttContent.length}`);

    // 4. Save VTT file to Firebase Storage
    const vttPath = `episodes/${episodeId}/subtitles/ko.vtt`;
    const vttFile = bucket.file(vttPath);
    await vttFile.save(vttContent, { metadata: { contentType: 'text/vtt' } });
    const vttUrl = getPublicUrl(bucketName, vttPath);
    console.log(`[Gemini-Process] VTT file saved to Storage. URL: ${vttUrl}`);

    // 5. Save data to Firestore
    // Save full transcript and VTT URL
    await episodeRef.update({ 
        transcript: transcriptText,
        vttUrl: vttUrl,
        vttPath: vttPath,
        aiProcessingStatus: 'completed',
    });
    console.log(`[Gemini-Process] Full transcript and VTT URL saved to Firestore.`);

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

    // 6. Clean up file from Google AI File API
    console.log(`[Gemini-Process] Deleting file from Google AI File API: ${uploadResult.file.name}`);
    await fileManager.deleteFile(uploadResult.file.name);
    console.log(`[Gemini-Process] File deleted from Google AI File API.`);

    return { 
        success: true, 
        message: 'Video processed successfully with Gemini.', 
        transcript: transcriptText,
        vttUrl,
        vttPath,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[Gemini-Process-ERROR]', error);
    
    // Update Firestore with failure status
    const db = admin.firestore(initializeAdminApp());
    const episodeRef = db.collection('episodes').doc(episodeId);
    try {
        await episodeRef.update({ aiProcessingStatus: 'failed', aiProcessingError: errorMessage });
    } catch (dbError) {
        console.error(`[Gemini-Process-ERROR] Failed to write error status to Firestore for episode ${episodeId}:`, dbError);
    }
    
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  } finally {
      // Clean up temporary file
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
        console.log(`[Gemini-Process] Cleaned up temporary file: ${tempVideoPath}`);
      }
  }
}
