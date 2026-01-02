import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenerativeAIFileManager } from "@google/generative-ai/server";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn(
    'GEMINI_API_KEY environment variable is not set. Google AI functions will fail.'
  );
}

export const googleAI = new GoogleGenerativeAI(apiKey || '');
export const fileManager = new GoogleGenerativeAIFileManager(apiKey || '');
