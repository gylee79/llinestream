'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { getPublicUrl } from '../utils';
import { googleAI } from '@/lib/google-ai';
import type { FileState } from '@google/generative-ai/server';
import { Part } from '@google/generative-ai';


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
  console.log(`[Gemini-Process-MultiModal] Starting video processing for episode: ${episodeId}`);
  
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

    const model = googleAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    
    const videoFilePart: Part = {
        fileData: {
            mimeType: "video/mp4",
            fileUri: fileUrl
        }
    };
    
    console.log(`[Gemini-Process-MultiModal] Starting multimodal analysis for URL: ${fileUrl}`);

    const multimodalPrompt = `You are an expert transcriber and content analyst.
Analyze the provided video file and perform the following tasks precisely in Korean:
1.  **Full Transcription**: Transcribe the entire audio content of the video accurately. This will be the pure audio script.
2.  **Detailed Visual Description**: Describe all important visual elements presented on the screen throughout the video. This includes text on slides, data in charts and graphs, diagrams, and any other key visual information. Be detailed and specific.
3.  **Comprehensive Summary**: Combine the transcription and visual description to create a comprehensive summary of the video's content. This summary should integrate both what was said and what was shown.

Structure your response as a single JSON object with the following three keys: "transcript", "visualDescription", "summary". Do not include any other text or markdown formatting outside of this JSON object.`;

    const vttPrompt = "Transcribe this video file into a WebVTT (VTT) format subtitle file. Ensure accurate timestamps and text. Start with WEBVTT.";

    const [multimodalResult, vttResult] = await Promise.all([
        model.generateContent([multimodalPrompt, videoFilePart]),
        model.generateContent([vttPrompt, videoFilePart]),
    ]);
    
    // --- Multimodal Analysis Processing ---
    const multimodalResponseText = multimodalResult.response.text();
    let multimodalData;
    try {
        multimodalData = JSON.parse(multimodalResponseText);
    } catch (e) {
        console.error("[Gemini-Process-MultiModal] Failed to parse JSON from multimodal response:", multimodalResponseText);
        throw new Error("Failed to parse AI analysis response. The response was not valid JSON.");
    }

    const { transcript, visualDescription, summary } = multimodalData;
    const aiGeneratedContent = `**요약:**\n${summary}\n\n**시각 정보:**\n${visualDescription}`;

    if (!transcript) {
        throw new Error('AI analysis returned no transcript text.');
    }
    console.log(`[Gemini-Process-MultiModal] Multimodal analysis successful. Transcript Length: ${transcript.length}, Visual Description Length: ${visualDescription.length}`);

    // --- VTT Processing ---
    let vttContent = vttResult.response.text();
    vttContent = vttContent.replace(/^```(vtt)?\n/,'').replace(/```$/, '');
    if (!vttContent) {
        throw new Error('VTT generation returned no text.');
    }
    console.log(`[Gemini-Process-MultiModal] VTT generation successful. Length: ${vttContent.length}`);
    
    const vttPath = `episodes/${episodeId}/subtitles/ko.vtt`;
    const vttFile = storage.bucket().file(vttPath);
    await vttFile.save(vttContent, { metadata: { contentType: 'text/vtt' } });
    const vttUrl = getPublicUrl(bucketName, vttPath);
    console.log(`[Gemini-Process-MultiModal] VTT file saved to Storage. URL: ${vttUrl}`);

    // --- Firestore Update ---
    await episodeRef.update({ 
        transcript: transcript, // Pure audio transcript
        aiGeneratedContent: aiGeneratedContent, // Combined summary and visual info
        vttUrl: vttUrl,
        vttPath: vttPath,
        aiProcessingStatus: 'completed',
    });
    console.log(`[Gemini-Process-MultiModal] Multimodal content and VTT URL saved to Firestore.`);

    const chunks = chunkText(aiGeneratedContent); // Chunk the combined content
    const batch = db.batch();
    const chunkCollectionRef = episodeRef.collection('chunks');
    
    const oldChunks = await chunkCollectionRef.listDocuments();
    oldChunks.forEach(doc => batch.delete(doc));

    chunks.forEach((text, i) => {
        const chunkDocRef = chunkCollectionRef.doc();
        batch.set(chunkDocRef, {
            text: text,
            startTime: i * 30, // Placeholder
        });
    });
    
    await batch.commit();
    console.log(`[Gemini-Process-MultiModal] Saved ${chunks.length} chunks to Firestore.`);

    return { 
        success: true, 
        message: 'Video processed successfully with Gemini Multimodal Analysis.', 
        transcript: transcript,
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
