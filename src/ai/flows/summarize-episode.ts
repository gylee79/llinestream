'use server';

/**
 * @fileOverview Provides a summary of an episode based on its video content.
 *
 * - summarizeEpisode - An async function that generates a summary of an episode.
 * - SummarizeEpisodeInput - The input type for the summarizeEpisode function.
 * - SummarizeEpisodeOutput - The return type for the summarizeEpisode function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeEpisodeInputSchema = z.object({
  videoContent: z
    .string()
    .describe("The transcribed text from the video, representing the episode's content."),
});
export type SummarizeEpisodeInput = z.infer<typeof SummarizeEpisodeInputSchema>;

const SummarizeEpisodeOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the episode content.'),
});
export type SummarizeEpisodeOutput = z.infer<typeof SummarizeEpisodeOutputSchema>;

export async function summarizeEpisode(input: SummarizeEpisodeInput): Promise<SummarizeEpisodeOutput> {
  return summarizeEpisodeFlow(input);
}

const summarizeEpisodePrompt = ai.definePrompt({
  name: 'summarizeEpisodePrompt',
  input: {schema: SummarizeEpisodeInputSchema},
  output: {schema: SummarizeEpisodeOutputSchema},
  prompt: `Summarize the following video content in a concise manner:\n\n{{{videoContent}}}`, 
});

const summarizeEpisodeFlow = ai.defineFlow(
  {
    name: 'summarizeEpisodeFlow',
    inputSchema: SummarizeEpisodeInputSchema,
    outputSchema: SummarizeEpisodeOutputSchema,
  },
  async input => {
    const {output} = await summarizeEpisodePrompt(input);
    return {
      ...output,
    };
  }
);
