
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { getPublicUrl } from '../utils';
import { googleAI } from '@/lib/google-ai';
import type { FileState } from '@google/generative-ai/server';

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
  
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
     if (!bucketName) {
      throw new Error('Firebase Storage bucket name is not configured in environment variables.');
    }

    const episodeRef = db.collection('episodes').doc(episodeId);
    await episodeRef.update({ aiProcessingStatus: 'processing', aiProcessingError: null });

    const model = googleAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // --- 핵심 변경점: 파일을 다시 업로드하는 대신 URL을 직접 사용 ---
    const videoFilePart = {
        fileData: {
            mimeType: "video/mp4", // 비디오 파일의 MIME 타입
            fileUri: fileUrl       // Firebase Storage의 공개 URL
        }
    };
    
    console.log(`[Gemini-Process] Starting transcription and VTT generation for URL: ${fileUrl}`);

    const transcriptionPrompt = "이 오디오 파일의 내용을 빠짐없이 정확하게 전체 텍스트로 받아 적어줘(Transcribe). 타임스탬프는 필요 없어.";
    const vttPrompt = "Transcribe this video file into a WebVTT (VTT) format subtitle file. Ensure accurate timestamps and text. Start with WEBVTT.";

    const [transcriptionResult, vttResult] = await Promise.all([
        model.generateContent([transcriptionPrompt, videoFilePart]),
        model.generateContent([vttPrompt, videoFilePart]),
    ]);
    
    const transcriptText = transcriptionResult.response.text();
    let vttContent = vttResult.response.text();

    vttContent = vttContent.replace(/^```(vtt)?\n/,'').replace(/```$/, '');

    if (!transcriptText || !vttContent) {
        throw new Error('Transcription or VTT generation returned no text.');
    }
    console.log(`[Gemini-Process] Transcription successful. Length: ${transcriptText.length}`);
    console.log(`[Gemini-Process] VTT generation successful. Length: ${vttContent.length}`);
    
    const vttPath = `episodes/${episodeId}/subtitles/ko.vtt`;
    const vttFile = storage.bucket().file(vttPath);
    await vttFile.save(vttContent, { metadata: { contentType: 'text/vtt' } });
    const vttUrl = getPublicUrl(bucketName, vttPath);
    console.log(`[Gemini-Process] VTT file saved to Storage. URL: ${vttUrl}`);

    await episodeRef.update({ 
        transcript: transcriptText,
        vttUrl: vttUrl,
        vttPath: vttPath,
        aiProcessingStatus: 'completed',
    });
    console.log(`[Gemini-Process] Full transcript and VTT URL saved to Firestore.`);

    const chunks = chunkText(transcriptText);
    const batch = db.batch();
    const chunkCollectionRef = episodeRef.collection('chunks');
    
    // Delete old chunks before adding new ones
    const oldChunks = await chunkCollectionRef.listDocuments();
    oldChunks.forEach(doc => batch.delete(doc));

    chunks.forEach((text, i) => {
        const chunkDocRef = chunkCollectionRef.doc();
        batch.set(chunkDocRef, {
            text: text,
            // You might want to get actual timestamps from VTT if available
            startTime: i * 30, // Placeholder
        });
    });
    
    await batch.commit();
    console.log(`[Gemini-Process] Saved ${chunks.length} chunks to Firestore.`);

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
    
    try {
        const db = admin.firestore(initializeAdminApp());
        const episodeRef = db.collection('episodes').doc(episodeId);
        await episodeRef.update({ aiProcessingStatus: 'failed', aiProcessingError: errorMessage });
    } catch (dbError) {
        console.error(`[Gemini-Process-ERROR] Failed to write error status to Firestore for episode ${episodeId}:`, dbError);
    }
    
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  }
}
