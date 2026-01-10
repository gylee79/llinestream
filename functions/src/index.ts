
import { onDocumentWritten, onDocumentDeleted, Change, FirestoreEvent } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

// 0. Firebase Admin 초기화
if (!getApps().length) {
  initializeApp();
}

// 1. API Key 비밀 설정
const apiKey = defineSecret("GOOGLE_GENAI_API_KEY");

// 2. Genkit 초기화 (공식 가이드 방식)
// ai 객체를 생성할 때 사용할 플러그인과 기본 모델을 명시적으로 지정합니다.
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-2.5-flash'), // 기본 모델 설정
});

// ==========================================
// [Genkit Flow] AI 로직 정의 (Brain)
// ==========================================

// 3. AI 분석 Flow의 입력과 출력 타입을 Zod 스키마로 명확하게 정의합니다.
const VideoAnalysisInputSchema = z.object({
  fileUri: z.string().describe("Gemini File API에 업로드된 비디오의 URI"),
  mimeType: z.string().describe("비디오의 MIME 타입"),
});

const AnalysisOutputSchema = z.object({
  transcript: z.string().describe('비디오의 전체 음성 스크립트'),
  summary: z.string().describe('비디오 전체 내용에 대한 간결한 요약'),
  timeline: z.array(z.object({
    timestamp: z.string().describe('이벤트 타임스탬프 (HH:MM:SS 형식)'),
    event: z.string().describe('해당 타임스탬프에 일어나는 일에 대한 설명'),
    visualDetail: z.string().describe('객체나 인물 등장과 같은 주목할 만한 시각적 정보'),
  })).describe('비디오 전체의 시간대별 이벤트 로그 배열'),
  visualCues: z.array(z.string()).describe('화면에 표시되는 중요한 텍스트(OCR) 또는 중요한 시각적 객체 목록'),
  keywords: z.array(z.string()).describe('검색 및 태깅을 위한 관련 키워드 배열'),
});

// 4. 비디오 분석 로직을 담당하는 Flow를 정의합니다. (공식 가이드 방식)
export const videoAnalysisFlow = ai.defineFlow(
  {
    name: 'videoAnalysisFlow',
    inputSchema: VideoAnalysisInputSchema,
    outputSchema: AnalysisOutputSchema,
  },
  async (input) => {
    // ai.generate를 직접 호출합니다.
    // 비디오 파일(media)과 텍스트 지시문(text)을 prompt 배열에 함께 전달합니다.
    const { output } = await ai.generate({
      prompt: [
        { text: "제공된 JSON 스키마에 따라 이 비디오 파일을 종합적으로 분석해주세요." },
        { media: { url: input.fileUri, contentType: input.mimeType } }
      ],
      output: { schema: AnalysisOutputSchema }, // 출력 포맷을 Zod 스키마로 강제합니다.
    });

    if (!output) {
      throw new Error("AI 분석이 결과를 생성하지 못했습니다.");
    }

    return output;
  }
);

// ==========================================
// [Trigger] 파일 처리 및 Flow 실행 (Hand)
// ==========================================

// [Helper] MIME Type 도구
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

export const analyzeVideoOnWrite = onDocumentWritten(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
    secrets: [apiKey],
    timeoutSeconds: 3600,
    memory: "2GiB",
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { episodeId: string }>) => {
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    if (!afterData) return;

    // 상태가 'pending'일 때만 'processing'으로 변경하고 함수를 트리거합니다.
    if (afterData.aiProcessingStatus === "pending") {
      console.log(`✨ New upload detected [${event.params.episodeId}]. Auto-starting...`);
      await change.after.ref.update({ aiProcessingStatus: "processing" });
      return;
    }

    // 이미 처리 중이거나 완료된 경우, 또는 상태가 'processing'이 아닌 경우는 무시합니다.
    if (afterData.aiProcessingStatus !== "processing" || beforeData?.aiProcessingStatus === "processing") {
      return;
    }

    const filePath = afterData.filePath;
    if (!filePath) {
      await change.after.ref.update({ aiProcessingStatus: "failed", aiProcessingError: "No filePath found" });
      return;
    }

    console.log("🚀 Starting Video Processing:", event.params.episodeId);

    const fileManager = new GoogleAIFileManager(apiKey.value());
    const tempFilePath = path.join(os.tmpdir(), `video_${event.params.episodeId}${path.extname(filePath)}`);
    let uploadedFileId = "";

    try {
      // 1. Storage에서 비디오 파일을 임시 디렉토리로 다운로드
      console.log(`📥 Downloading...`);
      await getStorage().bucket().file(filePath).download({ destination: tempFilePath });

      // 2. 임시 파일을 Gemini File API로 업로드
      const mimeType = getMimeType(filePath);
      console.log(`📡 Uploading to Gemini... (${mimeType})`);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: mimeType,
        displayName: `Episode ${event.params.episodeId}`,
      });

      const file = uploadResult.file;
      uploadedFileId = file.name;

      // 3. Gemini 측의 비디오 처리 완료 대기 (Polling)
      let state = file.state;
      console.log(`⏳ Waiting for Gemini processing...`);
      while (state === FileState.PROCESSING) {
        await new Promise((r) => setTimeout(r, 5000));
        state = (await fileManager.getFile(file.name)).state;
      }
      if (state === FileState.FAILED) throw new Error("Gemini File Processing Failed.");

      // 4. ★ 정의된 Genkit Flow 호출
      console.log(`🎥 Calling Genkit Flow...`);
      const result = await videoAnalysisFlow({
        fileUri: file.uri,
        mimeType: mimeType
      });

      // 5. 결과 포맷팅 및 Firestore에 저장
      const combinedContent = `
Summary: ${result.summary}\n
Timeline:
${result.timeline.map(t => `- [${t.timestamp}] ${t.event} (Visual: ${t.visualDetail})`).join('\n')}\n
Visual Cues: ${result.visualCues.join(', ')}\n
Keywords: ${result.keywords.join(', ')}
      `.trim();

      await change.after.ref.update({
        aiProcessingStatus: "completed",
        transcript: result.transcript,
        aiGeneratedContent: combinedContent,
        aiProcessingError: null,
        updatedAt: new Date()
      });
      console.log("✅ Analysis Success!");

    } catch (error) {
      console.error("❌ Error:", error);
      await change.after.ref.update({
        aiProcessingStatus: "failed",
        aiProcessingError: String(error)
      });
    } finally {
      // 6. 모든 작업 후 임시 파일 정리
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (uploadedFileId) {
        try { await fileManager.deleteFile(uploadedFileId); } catch (e) { console.log("⚠️ Cleanup warning"); }
      }
    }
  }
);

// 문서 삭제 시 Storage 파일 자동 청소 기능 (기존 유지)
export const deleteFilesOnEpisodeDelete = onDocumentDeleted(
  {
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const bucket = getStorage().bucket();
    const paths = [data.filePath, data.defaultThumbnailPath, data.customThumbnailPath, data.vttPath];
    
    await Promise.all(
      paths.filter(p => p).map(p => bucket.file(p).delete().catch(() => {}))
    );
    console.log(`✅ Cleanup finished: ${event.params.episodeId}`);
  }
);
