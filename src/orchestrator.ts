import { QueryAnalysis, ToolResult, Env, ResearchResult } from './types';
import { queryOptimizer } from './queryOptimizer';
import { selectBestTools, executeToolWithRetry } from './toolManager';
import { 
  assessRelevance, 
  analyzeGaps, 
  synthesizeResults, 
  extractSources, 
  calculateConfidence 
} from './resultProcessor';

// Main research orchestration function
export async function orchestrateResearch(
  query: string,
  depth: number = 3,
  env: Env
): Promise<ResearchResult> {
  // Check if we have a cached full research result
  if (env.RESEARCH_CACHE) {
    try {
      const cacheKey = `research_result:${query.trim().toLowerCase()}:${depth}`;
      const cachedResult = await env.RESEARCH_CACHE.get(cacheKey, 'json') as ResearchResult | null;
      
      if (cachedResult) {
        console.log('Returning cached research result');
        return {
          ...cachedResult,
          metadata: {
            ...cachedResult.metadata,
            fromCache: true
          }
        };
      }
    } catch (error) {
      console.error('Error retrieving cached research result:', error);
    }
  }
  
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
  
  const result: ResearchResult = {
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
  
  // Cache the full research result
  if (env.RESEARCH_CACHE) {
    try {
      const cacheKey = `research_result:${query.trim().toLowerCase()}:${depth}`;
      // Cache for 3 days (259200 seconds)
      await env.RESEARCH_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 259200 });
    } catch (error) {
      console.error('Error caching research result:', error);
    }
  }
  
  return result;
}

// Export the orchestrator
export const orchestrator = {
  orchestrateResearch
};
