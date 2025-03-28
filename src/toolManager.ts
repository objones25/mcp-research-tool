import { ToolCard, QueryAnalysis, Env, ToolResult } from './types';
import { tools } from './tools';
import { generateJSON } from './utils';
import { cacheManager } from './cacheManager';
import { z } from 'zod';

// Function to select best tools for the query
export async function selectBestTools(
  query: string, 
  analysis: QueryAnalysis, 
  env: Env,
  maxTools: number = 3
): Promise<{ selectedTools: ToolCard[]; reasoning: string[] }> {
  const scoredTools = Object.values(tools)
    .map(tool => ({ 
      tool, 
      score: tool.relevanceScore(query, analysis) 
    }))
    .sort((a, b) => b.score - a.score);
  
  try {
    const toolsInfo = scoredTools.map(({ tool, score }) => 
      `Tool: ${tool.name} (${tool.id})
       Score: ${score.toFixed(2)}
       Description: ${tool.description}
       Capabilities: ${tool.capabilities.join(', ')}
       Input Types: ${Object.entries(tool.inputTypes).map(([key, type]) => `${key}: ${type}`).join(', ')}
       Output Type: ${tool.outputType}
       Demo Commands: ${tool.demoCommands.map(cmd => `"${cmd.command}" (${cmd.description})`).join(', ')}
       Limitations: ${tool.metadata.limitations.join(', ')}
       Best Practices: ${tool.metadata.bestPractices.join(', ')}
       Compatible Query Types: ${Object.entries(tool.compatibilityMetadata.queryTypes).map(([type, weight]) => `${type} (${weight})`).join(', ')}
       Patterns: ${tool.compatibilityMetadata.patterns.join(', ')}
       URL Compatible: ${tool.compatibilityMetadata.urlCompatible ? 'Yes' : 'No'}
       Compatible Entity Types: ${tool.compatibilityMetadata.entityTypes.join(', ')}`
    ).join('\n\n');

    const prompt = `
Select the best tools (max ${maxTools}) for this query:
"${query}"

Query analysis:
- Intent: ${analysis.intent}
- Types: ${analysis.queryTypes.join(', ')}
- Entities: ${analysis.entities.join(', ')}
- URLs: ${analysis.extractedUrls.join(' ') || 'None'}

Requirements:
1. Select tools that cover DIFFERENT aspects of the query
2. Avoid tools that would return highly similar results
3. Prioritize tools that complement each other
4. Include at least one tool from each relevant query type if possible
5. Balance specialized and general-purpose tools

Available tools:
${toolsInfo}`;

    // Define schema for tool selection response
    const toolSelectionSchema = z.object({
      selectedTools: z.array(z.string()),
      reasoning: z.array(z.string())
    });
    
    const toolSelection = await generateJSON(
      prompt,
      env,
      toolSelectionSchema,
      {
        system: "You select the optimal research tools for queries, returning only valid JSON.",
        temperature: 0.2,
        provider: "openai",
        schemaDescription: "Tool selection with reasoning"
      }
    );
    
    const selectedTools = toolSelection.selectedTools
      .map((id: string) => Object.values(tools).find(tool => tool.id === id))
      .filter(Boolean) as ToolCard[];
    
    if (selectedTools.length > 0) {
      return {
        selectedTools,
        reasoning: toolSelection.reasoning || []
      };
    }
    throw new Error("No valid tools selected by LLM");
  } catch (error) {
    console.error('Tool selection error:', error);
    
    // Fall back to simple score-based selection
    return {
      selectedTools: scoredTools.slice(0, maxTools).map(item => item.tool),
      reasoning: ['Selected based on relevance scores (LLM selection failed)']
    };
  }
}

// Function to execute a tool with retry logic
export async function executeToolWithRetry(
  tool: ToolCard,
  params: Record<string, any>,
  env: Env,
  maxRetries: number = 2
): Promise<ToolResult> {
  // Try to get result from cache
  if (env.RESEARCH_CACHE) {
    return await cacheManager.executeWithCache(
      tool.id,
      async () => {
        // This function handles retry logic
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await tool.execute(params, env);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
              continue;
            }
            
            return {
              success: false,
              data: null,
              error: errorMessage,
              metadata: { attempts: attempt + 1 }
            };
          }
        }
        
        return {
          success: false,
          data: null,
          error: 'Unexpected execution flow',
          metadata: { attempts: maxRetries + 1 }
        };
      },
      params,
      env
    );
  } else {
    // Fall back to non-cached execution if KV is not available
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await tool.execute(params, env);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }
        
        return {
          success: false,
          data: null,
          error: errorMessage,
          metadata: { attempts: attempt + 1 }
        };
      }
    }
    
    return {
      success: false,
      data: null,
      error: 'Unexpected execution flow',
      metadata: { attempts: maxRetries + 1 }
    };
  }
} 