import { QueryAnalysis, Env, ToolCard } from './types';
import { generateJSON } from './utils';
import { z } from 'zod';

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

Query: "${query}"`;

  try {
    // Define schema for query analysis
    const queryAnalysisSchema = z.object({
      intent: z.enum(["search", "explain", "compare", "implement", "extract"]),
      entities: z.array(z.string()),
      queryTypes: z.array(
        z.enum(["technical", "current_events", "general_knowledge", "comparison", "implementation"])
      ),
      constraints: z.array(z.string())
    });
    
    const parsedResult = await generateJSON(
      prompt,
      env,
      queryAnalysisSchema,
      {
        system: "You analyze search queries and return only valid JSON with key information.",
        temperature: 0.2,
        provider: "groq",
        schemaDescription: "Query analysis structure"
      }
    );
    
    return {
      originalQuery: query,
      intent: parsedResult.intent,
      entities: parsedResult.entities,
      constraints: parsedResult.constraints,
      queryTypes: parsedResult.queryTypes,
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
4. Uses appropriate syntax for that tool`;

  try {
    // Create a schema that explicitly defines the expected structure
    // Create a dynamic schema based on the tool IDs
    const schemaProperties: Record<string, z.ZodTypeAny> = {};
    
    // Add each tool ID as a property in the schema
    tools.forEach(tool => {
      schemaProperties[tool.id] = z.object({
        query: z.string().describe(`Optimized query for the ${tool.id} tool`),
        params: z.record(z.string(), z.any()).optional().describe('Optional parameters for the query')
      }).describe(`Query optimization for ${tool.id}`);
    });
    
    // Create the final schema with all tool properties
    const toolQuerySchema = z.object(schemaProperties)
      .describe('Object containing optimized queries for each tool');
    
    return await generateJSON(
      prompt,
      env,
      toolQuerySchema,
      {
        system: "You optimize search queries for specific research tools. Generate a JSON object where each key is a tool ID and the value contains the optimized query and optional parameters.",
        temperature: 0.3,
        provider: "openai",
        schemaDescription: "Tool-specific query optimizations"
      }
    );
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