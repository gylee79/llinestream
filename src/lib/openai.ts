import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    'OPENAI_API_KEY environment variable is not set. Video processing will fail.'
  );
}

// Initialize OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
