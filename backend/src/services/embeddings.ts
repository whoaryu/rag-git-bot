import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is not defined in the environment.');
}

const ai = new GoogleGenAI({
  apiKey: apiKey || '',
});

/**
 * Generates a 768-dimensional embedding using Gemini's text-embedding-004 model.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text,
      config: {
        outputDimensionality: 768,
      },
    });

    if (response.embeddings && response.embeddings.length > 0) {
      const values = response.embeddings[0].values;
      if (values) {
        return values;
      }
    }

    throw new Error('No embedding values returned from Gemini API.');
  } catch (error) {
    console.error('Error generating embedding from Gemini:', error);
    throw error;
  }
}
export default generateEmbedding;
