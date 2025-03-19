import { tools } from './tools';
import { QueryAnalysis, ToolCard, ToolResult, Env, ResearchResult } from './types';
import { queryOptimizer } from './queryOptimizer';
import { callLLM } from './utils';

// Helper function to assess result relevance
async function assessRelevance(
  query: string,
  results: ToolResult[],
  env: Env
): Promise<ToolResult[]> {
  const today = new Date().toISOString().split('T')[0];
  
  const prompt = `
Assess which of these results are relevant and high-quality:

Query: "${query}"
Today's Date: ${today}

Results:
${results.map((r, i) => `
Result ${i + 1}:
${JSON.stringify(r.data, null, 2)}`).join('\n')}

Consider each result carefully:
1. Is it directly relevant to answering the query?
2. Is it from a reputable source?
3. Is it sufficiently current for this type of information?
4. Does it provide accurate, substantive information?

Return ONLY a JSON array of indices (0-based) for results that meet ALL criteria.`;

  try {
    const llmResult = await callLLM(prompt, env, {
      system: "You are a strict research analyst. Only include results that are relevant, reputable, current, and substantive.",
      temperature: 0.2
    });
    
    const relevantIndices = new Set(JSON.parse(llmResult));
    return results.filter((_, i) => relevantIndices.has(i));
  } catch (error) {
    console.error('Relevance assessment failed:', error);
    return results;
  }
}

// Helper function to analyze information gaps
async function analyzeGaps(
  query: string,
  currentResults: ToolResult[],
  env: Env
): Promise<{ hasGaps: boolean; followUpQuery?: string }> {
  const prompt = `
Analyze these research results for critical information gaps:

Original Query: "${query}"

Current Results:
${currentResults.map((r, i) => `
Result ${i + 1}:
${JSON.stringify(r.data, null, 2)}`).join('\n')}

Consider:
1. Are there MAJOR aspects of the query that remain completely unanswered?
2. Is there a CRITICAL piece of information missing that would significantly change the answer?
3. Would additional research likely yield substantially different or more accurate results?

Return ONLY a JSON object:
{
  "hasGaps": boolean,
  "followUpQuery": string or null,
  "gapExplanation": "Brief explanation of the critical gap, if any"
}

IMPORTANT: Only identify truly critical gaps that would significantly impact the answer.
If the current results provide a reasonably complete answer, return hasGaps: false.`;

  try {
    const llmResult = await callLLM(prompt, env, {
      system: "You analyze result completeness, identifying only critical information gaps that would substantially impact the answer. Be conservative - only suggest follow-up queries for major gaps.",
      temperature: 0.2
    });
    
    const { hasGaps, followUpQuery, gapExplanation } = JSON.parse(llmResult);
    if (hasGaps) {
      console.log(`Gap identified: ${gapExplanation}`);
    }
    return { hasGaps, followUpQuery: followUpQuery || undefined };
  } catch (error) {
    console.error('Gap analysis failed:', error);
    return { hasGaps: false };
  }
}

// Main research orchestration function
export async function orchestrateResearch(
  query: string,
  depth: number = 3,
  env: Env
): Promise<ResearchResult> {
  const startTime = Date.now();
  let iteration = 0;
  let allResults: ToolResult[] = [];
  let allSources: any[] = [];
  let currentQuery = query;
  let toolSelectionHistory = new Set<string>();
  
  // Initial query analysis
  const analysis = await queryOptimizer.analyzeQuery(query, env);
  
  while (iteration < depth) {
    console.log(`Starting iteration ${iteration + 1}/${depth}`);
    
    // Select tools for current iteration
    const { selectedTools } = await selectBestTools(
      currentQuery, 
      analysis,
      env,
      Math.ceil(depth * 1.5)
    );
    
    // Track which tools we've used to avoid repetition
    const newTools = selectedTools.filter(tool => !toolSelectionHistory.has(tool.id));
    if (newTools.length === 0) {
      console.log('No new tools available, terminating research');
      break;
    }
    newTools.forEach(tool => toolSelectionHistory.add(tool.id));
    
    // Optimize queries for selected tools
    const optimizedQueries = await queryOptimizer.optimizeQueriesForTools(
      currentQuery,
      analysis,
      newTools,
      env
    );
    
    // Execute tools with optimized queries
    const iterationResults = await Promise.all(
      newTools.map(tool => {
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
    
    // Assess relevance of new results
    const relevantResults = await assessRelevance(query, iterationResults, env);
    
    // Add relevant results to collection
    allResults = [...allResults, ...relevantResults];
    
    // Extract and collect sources
    const newSources = extractSources(relevantResults, newTools);
    allSources = [...allSources, ...newSources];
    
    // Analyze gaps and determine if another iteration is needed
    const { hasGaps, followUpQuery } = await analyzeGaps(query, allResults, env);
    
    // Check termination conditions
    if (!hasGaps || !followUpQuery) {
      console.log('No critical gaps found, terminating research');
      break;
    }
    
    // Update query for next iteration
    currentQuery = followUpQuery;
    iteration++;
    
    // Break if we've reached maximum depth
    if (iteration >= depth) {
      console.log('Reached maximum depth, terminating research');
      break;
    }
  }
  
  // Synthesize final results
  const answer = await synthesizeResults(query, allResults, env);
  const confidence = calculateConfidence(allResults, analysis, answer);
  
  return {
    answer,
    sources: allSources,
    confidence,
    metadata: {
      executionTime: Date.now() - startTime,
      iterations: iteration + 1,
      totalResults: allResults.length,
      queryTypes: analysis.queryTypes,
      toolsUsed: Array.from(toolSelectionHistory),
      toolResults: allResults.map((r, i) => ({
        tool: r.metadata?.toolId || `unknown_tool_${i}`,
        success: r.success,
        confidence: r.metadata?.confidence || 0
      }))
    }
  };
}

// Update synthesizeResults to handle array of results directly
async function synthesizeResults(
  query: string,
  results: ToolResult[],
  env: Env
): Promise<string> {
  const prompt = `
Synthesize these research results into a comprehensive answer:

Query: "${query}"

Results:
${results.map((r, i) => `
Result ${i + 1}:
${JSON.stringify(r.data, null, 2)}`).join('\n')}

Instructions:
1. Create a well-organized response
2. Use numbered citations [1], [2], etc.
3. Include a "Citations:" section
4. Bold key concepts
5. Each claim should be supported by citations
6. Address the original query directly`;

  try {
    return await callLLM(prompt, env, {
      system: "You synthesize research results into clear, well-structured answers with proper citations.",
      temperature: 0.5
    });
  } catch (error) {
    console.error('Results synthesis failed:', error);
    return `Unable to synthesize results. Found ${results.length} relevant results.`;
  }
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
