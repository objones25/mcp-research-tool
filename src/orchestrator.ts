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

Instructions:
1. Create a well-organized, informative response
2. Use numbered citations [1], [2], etc. to reference sources
3. Each claim should be supported by at least one citation
4. Include relevant details without overwhelming
5. Handle conflicting information or tool failures
6. Directly address the original query
7. Use consistent citation numbers throughout the text
8. Place citations at the end of relevant sentences
9. Multiple citations can be combined like [1,2] if needed
10. Every source used should be cited at least once
`;

    return await callLLM(prompt, env, {
      system: "You are an expert researcher who synthesizes information into accurate, helpful answers. Always use numbered citations to attribute information to sources.",
      temperature: 0.5,
      max_tokens: 2000
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

function extractSources(results: ToolResult[], tools: ToolCard[]): Array<{
  id: number;
  tool: string;
  url?: string;
  title?: string;
  metadata?: Record<string, any>;
}> {
  const sources = results.flatMap((result, index) => {
    if (!result.success || !result.data) return [];
    
    const tool = tools[index];
    const sourceData = [];
    
    if (Array.isArray(result.data)) {
      result.data.forEach((item, itemIndex) => {
        if (item.url || item.title) {
          sourceData.push({
            id: (index * 100) + itemIndex + 1, // Ensures unique IDs across tools
            tool: tool.name,
            url: item.url,
            title: item.title || item.url,
            metadata: {
              ...item,
              confidence: result.metadata?.confidence,
              toolType: tool.id
            }
          });
        }
      });
    } else if (result.data.url || result.data.title) {
      sourceData.push({
        id: (index * 100) + 1,
        tool: tool.name,
        url: result.data.url,
        title: result.data.title || result.data.url,
        metadata: {
          ...result.data,
          confidence: result.metadata?.confidence,
          toolType: tool.id
        }
      });
    }
    
    return sourceData;
  });

  // Sort by ID to ensure consistent ordering
  return sources.sort((a, b) => a.id - b.id);
}

function calculateConfidence(results: ToolResult[], analysis: QueryAnalysis): number {
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) return 0;
  
  // Calculate base confidence from tool results, with a minimum floor
  let avgConfidence = successfulResults.reduce(
    (sum, r) => sum + (r.metadata?.confidence || 0.5), 0
  ) / successfulResults.length;
  
  // Ensure a minimum base confidence if the result format is structured
  if (successfulResults.some(r => {
    const data = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return data.includes('### ') || data.includes('## ') || data.includes('**');
  })) {
    avgConfidence = Math.max(avgConfidence, 0.6);
  }
  
  // More flexible citation detection
  const citationPatterns = [
    /\[(\d+(?:,\s*\d+)*)\]/g,  // Standard [1] format
    /\[([a-zA-Z][^[\]]*)\]/g,  // [AuthorYear] format
    /\(([^()]*\d{4}[^()]*)\)/g // (Author et al., 2023) format
  ];
  
  const citationCount = citationPatterns.reduce((count, pattern) => {
    const matches = results.flatMap(r => 
      r.data?.toString().match(pattern) || []
    );
    return count + matches.length;
  }, 0);
  
  // Calculate a more lenient citation density
  const citationDensity = Math.min(
    (citationCount / Math.max(successfulResults.length * 3, 1)) * 2, // Multiply by 2 to increase weight
    1.0
  );
  
  // Consider content quality metrics
  const contentQualityIndicators = successfulResults.some(r => {
    const data = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return (
      data.includes('Conclusion') || 
      data.includes('References') || 
      (data.match(/\*\*[^*]+\*\*/g)?.length ?? 0) > 5 || // Has multiple bold sections
      data.includes('Introduction') ||
      data.includes('Summary') ||
      /\d{4}/.test(data) // Contains years (likely references)
    );
  });
  
  const contentQualityFactor = contentQualityIndicators ? 0.8 : 0.5;
  
  // Consider source diversity
  const uniqueToolTypes = new Set(
    successfulResults.map(r => r.metadata?.toolType).filter(Boolean)
  ).size;
  const sourceDiversityFactor = Math.min(uniqueToolTypes / 2, 1.0); // Normalize to max of 1.0
  
  // Adjust weights
  const weights = {
    toolResults: 0.35,
    queryAnalysis: 0.15,
    citations: 0.15,
    contentQuality: 0.25,
    sourceDiversity: 0.10
  };
  
  // Calculate final confidence score
  const confidenceScore = Math.min(
    (avgConfidence * weights.toolResults) +
    (analysis.confidence * weights.queryAnalysis) +
    (citationDensity * weights.citations) +
    (contentQualityFactor * weights.contentQuality) +
    (sourceDiversityFactor * weights.sourceDiversity),
    1.0
  );
  
  // Add confidence calculation details to metadata
  const confidenceMetadata = {
    baseConfidence: avgConfidence,
    citationDensity,
    contentQualityFactor,
    sourceDiversityFactor,
    citationCount,
    uniqueToolTypes,
    weights
  };
  
  // Store metadata in the first successful result for debugging
  if (successfulResults.length > 0) {
    const firstResult = successfulResults[0];
    firstResult.metadata = {
      ...(firstResult.metadata || {}),
      confidenceCalculation: confidenceMetadata
    };
  }
  
  return confidenceScore;
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
