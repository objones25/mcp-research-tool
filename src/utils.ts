import { Env } from './types';

interface LLMRequest {
  model: string;
  messages: Array<{role: string; content: string}>;
  temperature?: number;
  max_tokens?: number;
}

// Function to call OpenAI's GPT models
async function callOpenAI(request: LLMRequest, apiKey: string): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(request)
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }
  
  return await response.json();
}

// Function to call Workers AI (Llama models)
async function callWorkersAI(request: LLMRequest, env: Env): Promise<any> {
  const messages = request.messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  
  // @ts-ignore - Using Workers AI binding
  const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
    messages,
    max_tokens: request.max_tokens || 1024,
    temperature: request.temperature || 0.7
  });
  
  return response;
}

// Unified LLM interface that can switch between providers
export async function callLLM(
  prompt: string, 
  env: Env, 
  options: {
    system?: string;
    temperature?: number;
    max_tokens?: number;
    provider?: 'openai' | 'workersai';
  } = {}
): Promise<string> {
  const { 
    system = "You are a helpful assistant.", 
    temperature = 0.7, 
    max_tokens = 1024,
    provider = 'openai'
  } = options;
  
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ];
  
  try {
    if (provider === 'openai' && env.OPENAI_API_KEY) {
      const request: LLMRequest = {
        model: 'gpt-4-turbo',
        messages,
        temperature,
        max_tokens
      };
      
      const response = await callOpenAI(request, env.OPENAI_API_KEY);
      return response.choices[0].message.content;
    } else {
      // Fall back to Workers AI
      const request: LLMRequest = {
        model: '@cf/meta/llama-3-8b-instruct',
        messages,
        temperature,
        max_tokens
      };
      
      const response = await callWorkersAI(request, env);
      return response.response;
    }
  } catch (error) {
    console.error('Error calling LLM:', error);
    throw error;
  }
}

// Export utility functions
export const utils = {
  callLLM
};
