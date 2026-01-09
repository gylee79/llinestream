
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

// Enable Firebase telemetry and logging.
enableFirebaseTelemetry();

// Export the configured Genkit instance for use in other functions.
export const ai = genkit({
  plugins: [
    googleAI({
      apiVersion: "v1beta",
    }),
  ],
});
