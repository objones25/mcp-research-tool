import { Env } from './types';
import { generateText, generateObject } from 'ai';
import {createOpenAI } from '@ai-sdk/openai';
import {createGroq } from '@ai-sdk/groq';
import { z } from 'zod';

/**
 * Generate text using AI SDK
 */
export async function callLLM(
  prompt: string,
  env: Env,
  options: {
    system?: string;
    temperature?: number;
    max_tokens?: number;
    provider?: 'openai' | 'groq';
    model?: string;
  } = {}
): Promise<string> {
  const {
    system = "You are a helpful assistant.",
    temperature = 0.7,
    max_tokens = 1024,
    provider = 'openai',
    model = provider === 'openai' ? 'gpt-4-turbo' : 'llama-3.3-70b-versatile'
  } = options;

  try {
    if (provider === 'openai') {
      if (!env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required but not configured');
      }
      
      // Create a configured OpenAI client with the API key
      const openaiClient = createOpenAI({ apiKey: env.OPENAI_API_KEY });
      
      const { text } = await generateText({
        model: openaiClient(model as any),
        prompt,
        system,
        temperature,
        maxTokens: max_tokens
      });
      
      return text;
    } else if (provider === 'groq') {
      if (!env.GROQ_API_KEY) {
        throw new Error('Groq API key is required but not configured');
      }
      
      // Create a configured Groq client with the API key
      const groqClient = createGroq({ apiKey: env.GROQ_API_KEY });
      
      const { text } = await generateText({
        model: groqClient(model as any),
        prompt,
        system,
        temperature,
        maxTokens: max_tokens
      });
      
      return text;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (error) {
    console.error('Error calling LLM:', error);
    throw error;
  }
}

/**
 * Generate structured JSON response using AI SDK with schema validation
 */
export async function generateJSON<T>(
  prompt: string,
  env: Env,
  schema: z.ZodType<T>,
  options: {
    system?: string;
    temperature?: number;
    provider?: 'openai' | 'groq';
    model?: string;
    schemaDescription?: string;
  } = {}
): Promise<T> {
  const {
    system = "You are a helpful assistant that creates accurate structured data.",
    temperature = 0.3,
    provider = 'openai',
    model = provider === 'openai' ? 'gpt-4-turbo' : 'llama-3.3-70b-versatile',
    schemaDescription = "Generated structured data"
  } = options;

  try {
    if (provider === 'openai') {
      if (!env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required but not configured');
      }
      
      // Create a configured OpenAI client with the API key
      const openaiClient = createOpenAI({ apiKey: env.OPENAI_API_KEY });
      
      const { object } = await generateObject({
        model: openaiClient(model as any),
        schema,
        prompt,
        system,
        temperature,
        schemaDescription
      });
      
      return object as T;
    } else if (provider === 'groq') {
      if (!env.GROQ_API_KEY) {
        throw new Error('Groq API key is required but not configured');
      }
      
      // Create a configured Groq client with the API key
      const groqClient = createGroq({ apiKey: env.GROQ_API_KEY });
      
      const { object } = await generateObject({
        model: groqClient(model as any),
        schema,
        prompt,
        system,
        temperature,
        schemaDescription
      });
      
      return object as T;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (error) {
    console.error('Error generating JSON with schema:', error);
    throw error;
  }
}

/**
 * Generate array of structured items using AI SDK with schema validation
 */
export async function generateArray<T>(
  prompt: string,
  env: Env,
  itemSchema: z.ZodType<T>,
  options: {
    system?: string;
    temperature?: number;
    provider?: 'openai' | 'groq';
    model?: string;
    schemaDescription?: string;
  } = {}
): Promise<T[]> {
  const {
    system = "You are a helpful assistant that creates accurate structured data.",
    temperature = 0.3,
    provider = 'openai',
    model = provider === 'openai' ? 'gpt-4-turbo' : 'llama-3.3-70b-versatile',
    schemaDescription = "Generated array of structured items"
  } = options;

  try {
    if (provider === 'openai') {
      if (!env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is required but not configured');
      }
      
      // Create a configured OpenAI client with the API key
      const openaiClient = createOpenAI({ apiKey: env.OPENAI_API_KEY });
      
      const { object } = await generateObject({
        model: openaiClient(model as any),
        output: 'array',
        schema: itemSchema,
        prompt,
        system,
        temperature,
        schemaDescription
      });
      
      return object as T[];
    } else if (provider === 'groq') {
      if (!env.GROQ_API_KEY) {
        throw new Error('Groq API key is required but not configured');
      }
      
      // Create a configured Groq client with the API key
      const groqClient = createGroq({ apiKey: env.GROQ_API_KEY });
      
      const { object } = await generateObject({
        model: groqClient(model as any),
        output: 'array',
        schema: itemSchema,
        prompt,
        system,
        temperature,
        schemaDescription
      });
      
      return object as T[];
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (error) {
    console.error('Error generating array with schema:', error);
    throw error;
  }
}

// Export utility functions
export const utils = {
  callLLM,
  generateJSON,
  generateArray
};
