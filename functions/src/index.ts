/**
 * @fileoverview Lightweight Video Analysis (Fixed: gemini-2.5-flash)
 */
import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// 0. Firebase Admin 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

// 1. 전역 옵션 설정 (미국 리전 통일)
setGlobalOptions({
  region: "us-central1",
  secrets: ["GOOGLE_GENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "2GiB",
});

// 2. MIME Type 도우미
function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".avi": return "video/x-msvideo";
    case ".wmv": return "video/x-ms-wmv";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    default: return "video/mp4";
  }
}

// 3. 지연 초기화 (SDK)
let genAI: GoogleGenerativeAI | null = null;
let fileManager: any = null;

function initializeTools() {
  if (genAI && fileManager) return { genAI, fileManager };
  
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENAI_API_KEY is missing!");

  genAI = new GoogleGenerativeAI(apiKey);
  fileManager = new GoogleAIFileManager(apiKey);
  return { genAI, fileManager };
}

// ==========================================
// [Trigger] 메인 분석 함수
// ==========================================
export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
  }, 
  async (event) => {
    const change = event.data;
    if (!change) return;

    if (!change.after.exists) {
      console.log(`[${event.params.episodeId}] Document deleted.`);
      return;
    }
    const afterData = change.after.data();
    if (!afterData) return;
    const { episodeId } = event.params;

    // 상태 체크
    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${episodeId}]. Starting...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }
    if (afterData.aiProcessingStatus !== "processing") return;

    const filePath = afterData.filePath;
    if (!filePath) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath" });
      return;
    }

    console.log(`🚀 [${episodeId}] Processing started (Target: gemini-2.5-flash).`);
    
    // 도구 초기화
    const { genAI, fileManager } = initializeTools();
    const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
    let uploadedFile: any = null;
    const bucket = admin.storage().bucket();

    try {
      // 1. 다운로드
      await bucket.file(filePath).download({ destination: tempFilePath });
      
      // 2. 업로드 (Google AI)
      const uploadResponse = await fileManager.uploadFile(tempFilePath, {
        mimeType: getMimeType(filePath),
        displayName: episodeId,
      });
      uploadedFile = uploadResponse.file;
      console.log(`[${episodeId}] Uploaded: ${uploadedFile.uri}`);

      // 3. 대기 (Polling)
      let state = uploadedFile.state;
      while (state === FileState.PROCESSING) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const freshFile = await fileManager.getFile(uploadedFile.name);
        state = freshFile.state;
        console.log(`... processing status: ${state}`);
      }

      if (state === FileState.FAILED) throw new Error("Google AI processing failed.");

      // 4. AI 분석
      console.log(`[${episodeId}] Calling Gemini 2.5 Flash...`);
      
      const model = genAI!.getGenerativeModel({ model: "gemini-2.5-flash" }); 

      const prompt = `Analyze this video file comprehensively and generate a valid JSON object. The entire JSON output, including all text fields, MUST be in Korean.
The JSON object must have the following fields:
- "transcript": The full and accurate audio transcript of the video, in Korean.
- "summary": A concise summary of the content, in Korean.
- "timeline": An array of subtitle objects. Each object must have "startTime" (in HH:MM:SS.mmm format), "endTime" (in HH:MM:SS.mmm format), and "subtitle" (the Korean text for that time range). This timeline should cover the entire video and be suitable for creating a VTT subtitle file.
- "visualCues": A list of important on-screen text or objects, described in Korean.
- "keywords": An array of relevant keywords, in Korean.`;
      
      const result = await model.generateContent([
        { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
        { text: prompt }
      ]);

      const responseText = result.response.text();
      
      // JSON 파싱
      const cleanedText = responseText.replace(/```json|```/g, "").trim();
      const output = JSON.parse(cleanedText);

      // 5. VTT 자막 파일 생성 및 업로드
      let vttUrl = null;
      let vttPath = null;
      if (output.timeline && Array.isArray(output.timeline)) {
        const vttContent = `WEBVTT\n\n${output.timeline
          .map((item: any) => `${item.startTime} --> ${item.endTime}\n${item.subtitle}`)
          .join('\n\n')}`;
        
        const vttTempPath = path.join(os.tmpdir(), `${episodeId}.vtt`);
        fs.writeFileSync(vttTempPath, vttContent);
        
        vttPath = `episodes/${episodeId}/subtitles/${episodeId}.vtt`;
        await bucket.file(vttPath).upload(vttTempPath, {
          metadata: { contentType: 'text/vtt' },
        });

        vttUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(vttPath)}?alt=media`;
        fs.unlinkSync(vttTempPath); // 임시 파일 삭제
        console.log(`[${episodeId}] VTT subtitle file created and uploaded.`);
      }

      const combinedContent = `
요약: ${output.summary}\n
키워드: ${output.keywords?.join(', ') || ''}
      `.trim();

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: output.transcript || "",
        aiGeneratedContent: combinedContent,
        vttUrl: vttUrl,
        vttPath: vttPath,
        aiProcessingError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ [${episodeId}] Success!`);

    } catch (error: any) {
      console.error(`❌ [${episodeId}] Error:`, error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: error.message || String(error)
      });
    } finally {
      // 6. 청소
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { /* 무시 */ }
      }
      if (uploadedFile) {
        try { await fileManager.deleteFile(uploadedFile.name); } catch (e) { console.warn("Cleanup warning:", e); }
      }
    }
  }
);

export const deleteFilesOnEpisodeDelete = onDocumentDeleted("episodes/{episodeId}", async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data) return;
    const bucket = admin.storage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    await Promise.all(paths.filter(p => p).map(p => bucket.file(p).delete().catch(() => {})));
});
