'use server';
/**
 * @fileOverview Automatically generates thumbnails from uploaded video files.
 *
 * - generateVideoThumbnail - A function that generates a thumbnail for a given video.
 * - GenerateVideoThumbnailInput - The input type for the generateVideoThumbnail function.
 * - GenerateVideoThumbnailOutput - The return type for the generateVideoThumbnail function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const GenerateVideoThumbnailInputSchema = z.object({
  videoDataUri: z
    .string()
    .describe(
      "A video file, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  description: z.string().optional().describe('The description of the video.'),
});
export type GenerateVideoThumbnailInput = z.infer<typeof GenerateVideoThumbnailInputSchema>;

const GenerateVideoThumbnailOutputSchema = z.object({
  thumbnailDataUri: z
    .string()
    .describe('The generated thumbnail as a data URI (e.g., data:image/jpeg;base64,...).'),
});
export type GenerateVideoThumbnailOutput = z.infer<typeof GenerateVideoThumbnailOutputSchema>;

export async function generateVideoThumbnail(
  input: GenerateVideoThumbnailInput
): Promise<GenerateVideoThumbnailOutput> {
  return generateVideoThumbnailFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateVideoThumbnailPrompt',
  input: {schema: GenerateVideoThumbnailInputSchema},
  output: {schema: GenerateVideoThumbnailOutputSchema},
  prompt: `You are an expert in generating visually appealing thumbnails for videos.

  Given a video, analyze its content and create a representative thumbnail that captures the essence of the video.
  The thumbnail should be suitable for attracting viewers and providing a clear indication of the video's subject matter.
  Consider using a frame that is visually interesting and informative.

  Return the thumbnail as a data URI.
  Video: {{media url=videoDataUri}}`,
});

const generateVideoThumbnailFlow = ai.defineFlow(
  {
    name: 'generateVideoThumbnailFlow',
    inputSchema: GenerateVideoThumbnailInputSchema,
    outputSchema: GenerateVideoThumbnailOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
