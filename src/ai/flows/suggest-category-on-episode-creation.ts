'use server';
/**
 * @fileOverview This file contains a Genkit flow for suggesting relevant categories (분야, 큰분류, 상세분류) for a video episode based on its title and description.
 *
 * - suggestCategories - An async function that takes episode title and description as input and returns a suggestion for categories.
 * - SuggestCategoriesInput - The input type for the suggestCategories function.
 * - SuggestCategoriesOutput - The output type for the suggestCategories function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const SuggestCategoriesInputSchema = z.object({
  title: z.string().describe('The title of the video episode.'),
  description: z.string().describe('The description of the video episode.'),
});
export type SuggestCategoriesInput = z.infer<typeof SuggestCategoriesInputSchema>;

const SuggestCategoriesOutputSchema = z.object({
  field: z.string().describe('Suggested 분야 (field) for the episode.'),
  classification: z.string().describe('Suggested 큰분류 (classification) for the episode.'),
  course: z.string().describe('Suggested 상세분류 (course) for the episode.'),
});
export type SuggestCategoriesOutput = z.infer<typeof SuggestCategoriesOutputSchema>;

export async function suggestCategories(input: SuggestCategoriesInput): Promise<SuggestCategoriesOutput> {
  return suggestCategoriesFlow(input);
}

const suggestCategoriesPrompt = ai.definePrompt({
  name: 'suggestCategoriesPrompt',
  input: {schema: SuggestCategoriesInputSchema},
  output: {schema: SuggestCategoriesOutputSchema},
  prompt: `Given the title and description of a video episode, suggest the most relevant category for it.

Title: {{{title}}}
Description: {{{description}}}

Suggest a 분야 (field), a 큰분류 (classification), and a 상세분류 (course) for this episode.
Ensure that the suggestion is formatted properly.

{
  "field": "suggested field",
  "classification": "suggested classification",
  "course": "suggested course",
}`, 
});

const suggestCategoriesFlow = ai.defineFlow(
  {
    name: 'suggestCategoriesFlow',
    inputSchema: SuggestCategoriesInputSchema,
    outputSchema: SuggestCategoriesOutputSchema,
  },
  async input => {
    const {output} = await suggestCategoriesPrompt(input);
    return output!;
  }
);
