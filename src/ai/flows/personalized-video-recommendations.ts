'use server';
/**
 * @fileOverview This file implements the personalized video recommendations flow.
 *
 * It takes user viewing history and preferences as input and returns a list of recommended video IDs.
 *
 * @exported
 * - `getVideoRecommendations` - An async function that takes `VideoRecommendationInput` and returns `VideoRecommendationOutput`.
 * - `VideoRecommendationInput` - The input type for the getVideoRecommendations function.
 * - `VideoRecommendationOutput` - The return type for the getVideoRecommendations function.
 */

import {ai} from '@/ai/genkit';
import { z } from 'genkit';

const VideoRecommendationInputSchema = z.object({
  userId: z.string().describe('The ID of the user for whom to generate recommendations.'),
  viewingHistory: z
    .array(z.string())
    .describe('An array of video IDs representing the user viewing history.'),
  preferences: z
    .record(z.string(), z.any())
    .optional()
    .describe('A map of user preferences, such as preferred genres or actors.'),
});

export type VideoRecommendationInput = z.infer<typeof VideoRecommendationInputSchema>;

const VideoRecommendationOutputSchema = z.object({
  recommendedVideoIds: z
    .array(z.string())
    .describe('An array of video IDs that are recommended for the user.'),
});

export type VideoRecommendationOutput = z.infer<typeof VideoRecommendationOutputSchema>;

export async function getVideoRecommendations(input: VideoRecommendationInput): Promise<VideoRecommendationOutput> {
  return videoRecommendationFlow(input);
}

const trendingContentTool = ai.defineTool({
  name: 'getTrendingContent',
  description: 'Retrieves a list of trending video IDs, optionally filtered by category.',
  inputSchema: z.object({
    category: z.string().optional().describe('The category to filter trending videos by.'),
    limit: z.number().optional().describe('The maximum number of trending videos to return. Defaults to 10.'),
  }),
  outputSchema: z.array(z.string()).describe('An array of trending video IDs.'),
}, async (input) => {
  // TODO: Replace with actual implementation to fetch trending content.
  console.log('getTrendingContent called with input:', input);
  return [
    'trending-video-1',
    'trending-video-2',
    'trending-video-3',
  ]; // Replace with actual trending videos.
});

const videoRecommendationPrompt = ai.definePrompt({
  name: 'videoRecommendationPrompt',
  input: {schema: VideoRecommendationInputSchema},
  output: {schema: VideoRecommendationOutputSchema},
  tools: [trendingContentTool],
  prompt: `You are a video recommendation expert.

  Based on the user's viewing history and preferences, recommend videos that they might like.
  Consider the user's viewing history to understand their interests.
  Use the getTrendingContent tool to discover trending videos that might be of interest to the user.

  User ID: {{{userId}}}
  Viewing History: {{#if viewingHistory}}{{{viewingHistory}}}{{else}}None{{/if}}
  Preferences: {{#if preferences}}{{{preferences}}}{{else}}None{{/if}}

  Format your response as a JSON object with a "recommendedVideoIds" field containing an array of video IDs.
  `,
});

const videoRecommendationFlow = ai.defineFlow(
  {
    name: 'videoRecommendationFlow',
    inputSchema: VideoRecommendationInputSchema,
    outputSchema: VideoRecommendationOutputSchema,
  },
  async input => {
    const {output} = await videoRecommendationPrompt(input);
    return output!;
  }
);
