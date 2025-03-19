import { tools } from './tools';
import { QueryAnalysis, ToolCard, ToolResult, Env, ResearchResult } from './types';
import { queryOptimizer } from './queryOptimizer';
import { callLLM } from './utils';

// Combines tool selection, execution, and result synthesis into a single flow
export async function orchestrateResearch(
  query: string,
  depth: number = 3,
  env: Env
): Promise<ResearchResult> {
  const startTime = Date.now();
  
  // 1. Analyze the query using the new queryOptimizer
  const analysis = await queryOptimizer.analyzeQuery(query, env);
  
  // 2. Select tools using LLM
  const { selectedTools, reasoning } = await selectBestTools(query, analysis, env, Math.ceil(depth * 1.5));
  
  // 3. Optimize queries for selected tools
  const optimizedQueries = await queryOptimizer.optimizeQueriesForTools(query, analysis, selectedTools, env);
  
  // 4. Execute selected tools in parallel with optimized queries
  const results = await Promise.all(
    selectedTools.map(tool => {
      const optimizedParams = optimizedQueries[tool.id];
      return executeToolWithRetry(tool, {
        ...optimizedParams,
        ...(analysis.extractedUrls.length > 0 && { url: analysis.extractedUrls[0] }),
        ...(analysis.extractedYouTubeUrls.length > 0 && { 
          videoId: analysis.extractedYouTubeUrls[0].split('v=')[1] 
        })
      }, env);
    })
  );
  
  // 5. Use LLM to synthesize results
  const answer = await synthesizeResults(query, selectedTools, results, env);
  
  // 6. Extract sources
  const sources = extractSources(results, selectedTools);
  
  // 7. Calculate confidence using the synthesized answer
  const confidence = calculateConfidence(results, analysis, answer);
  
  // 8. Build the response
  return {
    answer,
    sources,
    confidence,
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
    // Enhanced prompt for synthesizing results
    const prompt = `
Synthesize these research results into a comprehensive answer:

Query: "${query}"

Results:
${toolResults}

Instructions:
1. Create a well-organized, informative response with clear structure
2. Use numbered citations [1], [2], etc. to reference sources
3. Include a dedicated "Citations:" or "References:" section at the end
4. Use headers (###) to organize your response into clear sections
5. Bold (**key concepts**) for improved readability
6. Include numbered or bulleted lists for clarity when appropriate
7. Each claim should be supported by at least one citation
8. Include relevant details without overwhelming
9. Directly address the original query
10. When relevant, include sections like "Introduction" and "Conclusion"
11. Ensure citations are properly formatted with source information

Additional guidance to improve quality:
- Structure helps: Use headers (###), bold text (**important**), and numbered points
- Citations matter: Include a dedicated "Citations:" section with proper formatting
- Completeness: Having Introduction, Core Sections, and Conclusion improves quality
- Source diversity: Reference multiple sources when possible
- Lists and bullets: Use them to break down complex information
- Key terms: Bold important concepts and terminology
- Section headers: Use clear, descriptive headers for each major point
- Citation format: [1] for inline citations, full reference in Citations section
`;

    return await callLLM(prompt, env, {
      system: "You are an expert researcher who synthesizes information into accurate, helpful answers. Always use numbered citations to attribute information to sources. Structure your response with clear sections, bold text for emphasis, and proper citation formatting.",
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

function calculateConfidence(results: ToolResult[], analysis: QueryAnalysis, synthesizedAnswer: string): number {
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) return 0;
  
  // Calculate base confidence from tool results
  let avgConfidence = successfulResults.reduce(
    (sum, r) => sum + (r.metadata?.confidence || 0.5), 0
  ) / successfulResults.length;
  
  // Enhanced citation pattern detection
  const citationPatterns = [
    /\[(\d+(?:,\s*\d+)*)\]/g,    // Standard [1] format
    /\[([a-zA-Z][^[\]]*)\]/g,    // [AuthorYear] format
    /\(([^()]*\d{4}[^()]*)\)/g,  // (Author et al., 2023) format
    /\[Source\]/g,               // [Source] format
    /\[\d+\]:/g                  // [1]: format (bibliography style)
  ];
  
  // Check citations in synthesized answer
  const citationCount = citationPatterns.reduce((count, pattern) => {
    const matches = synthesizedAnswer.match(pattern) || [];
    return count + matches.length;
  }, 0);
  
  // Calculate citation density based on answer length
  const wordCount = synthesizedAnswer.split(/\s+/).length;
  const citationDensity = Math.min(
    (citationCount / Math.max(Math.floor(wordCount / 100), 1)) * 2,
    1.0
  );
  
  // Check for sections in synthesized answer
  const hasSections = {
    introduction: /(?:^|\n)###?\s*Introduction/i.test(synthesizedAnswer),
    conclusion: /(?:^|\n)###?\s*Conclusion/i.test(synthesizedAnswer),
    citations: /(?:^|\n)###?\s*(?:Citations|References):/i.test(synthesizedAnswer),
    mainContent: (synthesizedAnswer.match(/(?:^|\n)###?\s+[^#\n]+/g) || []).length >= 2
  };
  
  // Calculate section score
  const sectionScore = Object.values(hasSections).filter(Boolean).length / 4;
  
  // Check formatting in synthesized answer
  const formatting = {
    boldText: (synthesizedAnswer.match(/\*\*[^*]+\*\*/g) || []).length >= 3,
    lists: /(?:^|\n)\s*[-*]\s+|\d+\.\s+/m.test(synthesizedAnswer),
    headers: (synthesizedAnswer.match(/(?:^|\n)#{1,3}\s+[^#\n]+/g) || []).length >= 2,
    paragraphs: synthesizedAnswer.split(/\n\n+/).length >= 3
  };
  
  // Calculate formatting score
  const formattingScore = Object.values(formatting).filter(Boolean).length / 4;
  
  // Check content quality indicators in synthesized answer
  const contentQuality = {
    keyTermsBolded: (synthesizedAnswer.match(/\*\*[^*]+\*\*/g) || []).length >= 5,
    properParagraphs: synthesizedAnswer.split(/\n\n+/).length >= 4,
    consistentFormatting: !/(#{1,3}\s*$|\*\*\s*\*\*)/m.test(synthesizedAnswer),
    meaningfulSections: (synthesizedAnswer.match(/(?:^|\n)###?\s+[^#\n]{10,}/g) || []).length >= 2
  };
  
  // Calculate content quality score
  const contentQualityScore = Object.values(contentQuality).filter(Boolean).length / 4;
  
  // Calculate source diversity
  const uniqueUrls = new Set(
    successfulResults.flatMap(r => {
      if (r.data && typeof r.data === 'object') {
        if (Array.isArray(r.data)) {
          return r.data.map(item => item.url).filter(Boolean);
        } else if (r.data.url) {
          return [r.data.url];
        }
      }
      return [];
    })
  ).size;
  
  const uniqueToolTypes = new Set(
    successfulResults.map(r => r.metadata?.toolType).filter(Boolean)
  ).size;
  
  const sourceDiversityFactor = Math.min((uniqueUrls / 2) + (uniqueToolTypes / 3), 1.0);
  
  // Recalibrated weights focusing more on synthesized answer quality
  const weights = {
    toolResults: 0.15,        // Decreased
    queryAnalysis: 0.10,      // Decreased
    citations: 0.20,          // Increased
    sections: 0.15,           // New weight
    formatting: 0.15,         // New weight
    contentQuality: 0.15,     // New weight
    sourceDiversity: 0.10     // Unchanged
  };
  
  // Calculate final confidence score with new weights
  const confidenceScore = Math.min(
    (avgConfidence * weights.toolResults) +
    (analysis.confidence * weights.queryAnalysis) +
    (citationDensity * weights.citations) +
    (sectionScore * weights.sections) +
    (formattingScore * weights.formatting) +
    (contentQualityScore * weights.contentQuality) +
    (sourceDiversityFactor * weights.sourceDiversity),
    1.0
  );
  
  // Enhanced confidence metadata
  const confidenceMetadata = {
    baseConfidence: avgConfidence,
    citationMetrics: {
      count: citationCount,
      density: citationDensity,
      perWordRatio: citationCount / wordCount
    },
    structureMetrics: {
      sections: hasSections,
      sectionScore,
      formatting,
      formattingScore
    },
    contentMetrics: {
      quality: contentQuality,
      qualityScore: contentQualityScore,
      wordCount
    },
    sourceMetrics: {
      uniqueUrls,
      uniqueToolTypes,
      diversityFactor: sourceDiversityFactor
    },
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
