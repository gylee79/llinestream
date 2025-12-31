
'use server';

import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import {firebase} from '@genkit-ai/firebase';
import { initializeAdminApp } from '@/lib/firebase-admin';

// This function call is crucial for Firebase Admin SDK initialization on the server.
const adminApp = initializeAdminApp();

export const ai = genkit({
  plugins: [
    googleAI(),
    firebase({ admin: adminApp }),
  ],
  logLevel: 'debug',
  enableTracingAndMetrics: true,
});
