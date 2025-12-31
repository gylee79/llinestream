'use server';

import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import {firebase} from '@genkit-ai/firebase';
import { initializeFirebase } from '@/firebase';

// This function call is crucial for Firebase Admin SDK initialization on the server.
initializeFirebase();

export const ai = genkit({
  plugins: [
    googleAI(),
    firebase(),
  ],
  model: 'googleai/gemini-1.5-flash',
  enableTracingAndMetrics: true,
  logLevel: 'debug'
});
