import { ToolCard, QueryAnalysis, Env, ToolResult } from './types';
import { tools } from './tools';
import { callLLM } from './utils';

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
       Patterns: ${tool.compatibilityMetadata.patterns.join(', ')}
       URL Compatible: ${tool.compatibilityMetadata.urlCompatible ? 'Yes' : 'No'}`
    ).join('\n\n');

    const prompt = `
Select the best tools (max ${maxTools}) for this query:
"${query}"

Query analysis:
- Intent: ${analysis.intent}
- Types: ${analysis.queryTypes.join(', ')}
- Entities: ${analysis.entities.join(', ')}
- URLs: ${analysis.extractedUrls.join(' ') || 'None'}

Available tools:
${toolsInfo}

Return only JSON in this format:
{
  "selectedTools": ["tool_id1", "tool_id2"],
  "reasoning": ["Reason 1", "Reason 2"]
}`;

    const llmResult = await callLLM(prompt, env, {
      system: "You select the optimal research tools for queries, returning only valid JSON.",
      temperature: 0.2
    });
    
    const parsedResult = JSON.parse(llmResult);
    const selectedTools = parsedResult.selectedTools
      .map((id: string) => Object.values(tools).find(tool => tool.id === id))
      .filter(Boolean) as ToolCard[];
    
    if (selectedTools.length > 0) {
      return {
        selectedTools,
        reasoning: parsedResult.reasoning || []
      };
    }
    throw new Error("No valid tools selected by LLM");
  } catch (error) {
    console.error('Tool selection error:', error);
    
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