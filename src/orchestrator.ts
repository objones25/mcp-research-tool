import { tools } from './tools';
import { QueryAnalysis, ToolCard, ToolResult, Env, ResearchResult } from './types';
import { analyzeQuery } from './queryEnhancer';
import { callLLM } from './utils';

// Combines tool selection, execution, and result synthesis into a single flow
export async function orchestrateResearch(
  query: string,
  depth: number = 3,
  env: Env
): Promise<ResearchResult> {
  const startTime = Date.now();
  
  // 1. Analyze the query using LLM
  const analysis = await analyzeQuery(query, env);
  
  // 2. Select tools using LLM
  const { selectedTools, reasoning } = await selectBestTools(query, analysis, env, Math.ceil(depth * 1.5));
  
  // 3. Execute selected tools in parallel
  const toolParams = {
    query,
    ...(analysis.extractedUrls.length > 0 && { url: analysis.extractedUrls[0] }),
    ...(analysis.extractedYouTubeUrls.length > 0 && { 
      videoId: analysis.extractedYouTubeUrls[0].split('v=')[1] 
    })
  };
  
  const results = await Promise.all(
    selectedTools.map(tool => executeToolWithRetry(tool, toolParams, env))
  );
  
  // 4. Use LLM to synthesize results
  const answer = await synthesizeResults(query, selectedTools, results, env);
  
  // 5. Build the response
  return {
    answer,
    sources: extractSources(results, selectedTools),
    confidence: calculateConfidence(results, analysis),
    metadata: {
      executionTime: Date.now() - startTime,
      toolsUsed: selectedTools.map(t => t.id),
      queryTypes: analysis.queryTypes,
      toolSelectionReasoning: reasoning,
      toolResults: results.map((r, i) => ({
        tool: selectedTools[i].id,
        success: r.success,
        confidence: r.metadata?.confidence || 0
      }))
    }
  };
}

// Helper functions with streamlined implementations
async function selectBestTools(
  query: string, 
  analysis: QueryAnalysis, 
  env: Env,
  maxTools: number = 3
): Promise<{ selectedTools: ToolCard[]; reasoning: string[] }> {
  // Get sorted tools by relevance score
  const scoredTools = Object.values(tools)
    .map(tool => ({ 
      tool, 
      score: tool.relevanceScore(query, analysis) 
    }))
    .sort((a, b) => b.score - a.score);
  
  // Try LLM-based selection
  try {
    // Build tool descriptions for prompt
    const toolsInfo = scoredTools.map(({ tool, score }) => 
      `Tool: ${tool.name} (${tool.id})
       Score: ${score.toFixed(2)}
       Description: ${tool.description}
       Patterns: ${tool.compatibilityMetadata.patterns.join(', ')}
       URL Compatible: ${tool.compatibilityMetadata.urlCompatible ? 'Yes' : 'No'}`
    ).join('\n\n');

    // Prompt for tool selection
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
    
    // Fallback to score-based selection
    return {
      selectedTools: scoredTools.slice(0, maxTools).map(item => item.tool),
      reasoning: ['Selected based on relevance scores (LLM selection failed)']
    };
  }
}

async function executeToolWithRetry(
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
  
  // This should never be reached due to the return in the catch block
  return {
    success: false,
    data: null,
    error: 'Unexpected execution flow',
    metadata: { attempts: maxRetries + 1 }
  };
}

async function synthesizeResults(
  query: string,
  tools: ToolCard[],
  results: ToolResult[],
  env: Env
): Promise<string> {
  // Format result data for the LLM
  const toolResults = tools.map((tool, i) => {
    const result = results[i];
    if (!result.success) return `[${tool.name}]: Failed - ${result.error}`;
    
    let dataOutput;
    if (Array.isArray(result.data)) {
      // Limit array output to first 3 items for brevity
      const items = result.data.slice(0, 3);
      dataOutput = items.map(item => JSON.stringify(item, null, 2)).join('\n');
      if (result.data.length > 3) {
        dataOutput += `\n... (${result.data.length - 3} more results)`;
      }
    } else {
      dataOutput = typeof result.data === 'object' 
        ? JSON.stringify(result.data, null, 2) 
        : String(result.data);
    }
    
    return `[${tool.name}]:\n${dataOutput}`;
  }).join('\n\n');
  
  try {
    // Prompt for synthesizing results
    const prompt = `
Synthesize these research results into a comprehensive answer:

Query: "${query}"

Results:
${toolResults}

- Create a well-organized, informative response
- Include relevant details without overwhelming 
- Properly attribute information to the sources
- Handle conflicting information or tool failures
- Directly address the original query
`;

    return await callLLM(prompt, env, {
      system: "You are an expert researcher who synthesizes information into accurate, helpful answers.",
      temperature: 0.5,
      max_tokens: 1500
    });
  } catch (error) {
    console.error('Results synthesis error:', error);
    
    // Simple fallback
    return `Research results for: "${query}"\n\n${
      results.map((result, i) => 
        `${tools[i].name}: ${result.success 
          ? `Found ${Array.isArray(result.data) ? result.data.length : '1'} result(s)` 
          : `Failed - ${result.error}`}`
      ).join('\n')
    }`;
  }
}

function extractSources(results: ToolResult[], tools: ToolCard[]): string[] {
  return [...new Set(
    results.flatMap((result, index) => {
      if (!result.success || !result.data) return [];
      
      const toolName = tools[index].name;
      const urls = [];
      
      if (Array.isArray(result.data)) {
        result.data.forEach(item => {
          if (item.url) urls.push(`${toolName}: ${item.url}`);
        });
      } else if (result.data.url) {
        urls.push(`${toolName}: ${result.data.url}`);
      }
      
      return urls;
    })
  )];
}

function calculateConfidence(results: ToolResult[], analysis: QueryAnalysis): number {
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) return 0;
  
  const avgConfidence = successfulResults.reduce(
    (sum, r) => sum + (r.metadata?.confidence || 0), 0
  ) / successfulResults.length;
  
  return Math.min(avgConfidence * analysis.confidence, 1.0);
}

// Export the orchestrator
export const orchestrator = {
  orchestrateResearch,
  selectBestTools,
  executeToolWithRetry,
  synthesizeResults,
  extractSources,
  calculateConfidence
};
