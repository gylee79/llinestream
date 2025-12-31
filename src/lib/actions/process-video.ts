
'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { Episode } from '../types';
import { extractPathFromUrl } from '../utils';
import { openai } from '@/lib/openai';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Splits text into chunks of a specified size, trying to break at sentence endings.
 * @param text The full text to chunk.
 * @param chunkSize The approximate size of each chunk.
 * @returns An array of text chunks.
 */
function chunkText(text: string, chunkSize = 800): string[] {
  const chunks: string[] = [];
  let remainingText = text;
  while (remainingText.length > 0) {
    if (remainingText.length <= chunkSize) {
      chunks.push(remainingText);
      break;
    }
    let chunk = remainingText.substring(0, chunkSize);
    let lastPeriod = chunk.lastIndexOf('.');
    let lastQuestionMark = chunk.lastIndexOf('?');
    let lastExclamationMark = chunk.lastIndexOf('!');
    let lastBreak = Math.max(lastPeriod, lastQuestionMark, lastExclamationMark);
    
    if (lastBreak > 0) {
      chunk = chunk.substring(0, lastBreak + 1);
    }
    
    chunks.push(chunk);
    remainingText = remainingText.substring(chunk.length);
  }
  return chunks;
}


/**
 * Processes a video for AI Q&A by transcribing, chunking, and creating embeddings.
 * @param episodeId The ID of the episode to process.
 * @returns A result object indicating success or failure.
 */
export async function processVideoForAI(episodeId: string): Promise<{ success: boolean; message: string }> {
  if (!process.env.OPENAI_API_KEY) {
      return { success: false, message: 'OpenAI API key is not configured on the server.' };
  }
  
  console.log(`[AI-Process] Starting video processing for episode: ${episodeId}`);

  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    const storage = admin.storage(adminApp);
    const bucket = storage.bucket();

    // 1. Get episode data from Firestore
    const episodeRef = db.collection('episodes').doc(episodeId);
    const episodeDoc = await episodeRef.get();
    if (!episodeDoc.exists) {
      throw new Error(`Episode with ID ${episodeId} not found.`);
    }
    const episode = episodeDoc.data() as Episode;
    const videoPath = extractPathFromUrl(episode.videoUrl);
    if (!videoPath) {
      throw new Error('Could not determine video path from URL.');
    }
    console.log(`[AI-Process] Found video path: ${videoPath}`);

    // 2. Download video file and extract audio
    const tempVideoPath = path.join(os.tmpdir(), `video_${episodeId}.mp4`);
    const tempAudioPath = path.join(os.tmpdir(), `audio_${episodeId}.mp3`);
    
    console.log(`[AI-Process] Downloading video to ${tempVideoPath}`);
    await bucket.file(videoPath).download({ destination: tempVideoPath });

    console.log(`[AI-Process] Extracting audio to ${tempAudioPath}`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempVideoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .save(tempAudioPath);
    });

    // 3. Transcribe audio using Whisper API
    console.log(`[AI-Process] Transcribing audio with Whisper...`);
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempAudioPath),
      model: 'whisper-1',
    });
    const transcriptText = transcription.text;
    console.log(`[AI-Process] Transcription successful. Length: ${transcriptText.length}`);

    // 4. Save full transcript to Firestore
    await episodeRef.update({ transcript: transcriptText });
    console.log(`[AI-Process] Full transcript saved to Firestore.`);

    // 5. Split transcript into chunks
    const chunks = chunkText(transcriptText);
    console.log(`[AI-Process] Split transcript into ${chunks.length} chunks.`);
    
    // 6. Generate embeddings and save chunks
    const chunkCollectionRef = episodeRef.collection('chunks');
    const batch = db.batch();

    for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i];
        console.log(`[AI-Process] Generating embedding for chunk ${i + 1}/${chunks.length}`);
        
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });

        const vector = embeddingResponse.data[0].embedding;
        
        const chunkDocRef = chunkCollectionRef.doc();
        batch.set(chunkDocRef, {
            text: text,
            vector: vector,
            // startTime is a placeholder for now, as Whisper doesn't provide reliable timestamps for full text.
            startTime: i * 30, // Approximate start time
        });
    }

    await batch.commit();
    console.log(`[AI-Process] All chunks and embeddings saved successfully.`);

    // Clean up temporary files
    fs.unlinkSync(tempVideoPath);
    fs.unlinkSync(tempAudioPath);
    console.log(`[AI-Process] Cleaned up temporary files.`);

    return { success: true, message: 'Video processed successfully for AI Q&A.' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error('[AI-Process-ERROR]', error);
    return { success: false, message: `Video processing failed: ${errorMessage}` };
  }
}
