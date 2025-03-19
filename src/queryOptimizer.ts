import { QueryAnalysis, Env, ToolCard } from './types';
import { callLLM } from './utils';

// Retained from queryEnhancer for backward compatibility
function extractUrls(query: string): string[] {
  return query.match(/(https?:\/\/[^\s]+)/g) || [];
}

function extractYouTubeUrls(query: string): string[] {
  return query.match(/(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g) || [];
}

// Core function: Analyze query to understand intent and context
export async function analyzeQuery(query: string, env: Env): Promise<QueryAnalysis> {
  const extractedUrls = extractUrls(query);
  const extractedYouTubeUrls = extractYouTubeUrls(query);
  
  const prompt = `
Analyze this search query and extract key information:

Query: "${query}"

Return ONLY this JSON structure:
{
  "intent": "search|explain|compare|implement|extract",
  "entities": ["entity1", "entity2"],
  "queryTypes": ["technical", "current_events", "general_knowledge", "comparison", "implementation"],
  "constraints": ["constraint1", "constraint2"]
}`;

  try {
    const llmResult = await callLLM(prompt, env, {
      system: "You analyze search queries and return only valid JSON with key information.",
      temperature: 0.2
    });
    
    const parsedResult = JSON.parse(llmResult);
    
    return {
      originalQuery: query,
      intent: parsedResult.intent || 'search',
      entities: parsedResult.entities || [],
      constraints: parsedResult.constraints || [],
      queryTypes: parsedResult.queryTypes || ['general_knowledge'],
      extractedUrls,
      extractedYouTubeUrls,
      confidence: 0.7
    };
  } catch (error) {
    console.error('Query analysis failed:', error);
    return {
      originalQuery: query,
      intent: 'search',
      entities: [],
      constraints: [],
      queryTypes: ['general_knowledge'],
      extractedUrls,
      extractedYouTubeUrls,
      confidence: 0.5
    };
  }
}

// Core function: Optimize queries for each tool
export async function optimizeQueriesForTools(
  query: string,
  analysis: QueryAnalysis,
  tools: ToolCard[],
  env: Env
): Promise<Record<string, any>> {
  const prompt = `
Optimize this query for each research tool:

Original Query: "${query}"
Intent: ${analysis.intent}
Query Types: ${analysis.queryTypes.join(', ')}
Entities: ${analysis.entities.join(', ')}
Constraints: ${analysis.constraints.join(', ')}

Tools:
${tools.map(tool => `
${tool.id}:
Description: ${tool.description}
Best for: ${Object.entries(tool.compatibilityMetadata.queryTypes)
  .filter(([_, score]) => score > 0.5)
  .map(([type]) => type)
  .join(', ')}`).join('\n')}

For each tool, return an optimized query that:
1. Matches the tool's strengths and capabilities
2. Preserves the original intent
3. Includes relevant constraints
4. Uses appropriate syntax for that tool

Return ONLY a JSON object in this format:
{
  "tool_id": {
    "query": "optimized query for this specific tool",
    "params": {} // Additional tool-specific parameters if needed
  }
}`;

  try {
    const llmResult = await callLLM(prompt, env, {
      system: "You optimize search queries for specific research tools, returning only valid JSON.",
      temperature: 0.3
    });
    
    return JSON.parse(llmResult);
  } catch (error) {
    console.error('Query optimization failed:', error);
    
    // Fallback: Return basic parameters for each tool
    return tools.reduce((acc, tool) => ({
      ...acc,
      [tool.id]: {
        query: query,
        params: {}
      }
    }), {});
  }
}

// Export the optimizer functions
export const queryOptimizer = {
  analyzeQuery,
  optimizeQueriesForTools
}; 