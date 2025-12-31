import { config } from 'dotenv';
config();

import '@/ai/flows/suggest-category-on-episode-creation.ts';
import '@/ai/flows/admin-auto-generate-video-thumbnails.ts';
import '@/ai/flows/summarize-episode.ts';
import '@/ai/flows/personalized-video-recommendations.ts';
import '@/ai/flows/video-tutor-flow.ts';
