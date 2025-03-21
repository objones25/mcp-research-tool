import { ToolResult, QueryAnalysis, Env, ToolCard } from './types';
import { callLLM, generateJSON, generateArray } from './utils';
import { z } from 'zod';

// Helper function to assess result relevance
export async function assessRelevance(
  query: string,
  results: ToolResult[],
  env: Env
): Promise<ToolResult[]> {
  const today = new Date().toISOString().split('T')[0];
  
  const prompt = `
Assess which of these results are both relevant and COMPLEMENTARY to each other:

Query: "${query}"
Today's Date: ${today}

Results:
${results.map((r, i) => `
Result ${i + 1}:
${JSON.stringify(r.data, null, 2)}`).join('\n')}

IMPORTANT: Select a diverse set of results that:
1. Cover different aspects of the query
2. Come from different sources/perspectives
3. Provide unique information not covered by other results
4. Collectively provide comprehensive coverage

Return ONLY indices (0-based) for results that are both RELEVANT AND ADD UNIQUE VALUE.`;

  try {
    // Define schema for relevant indices array
    const relevantIndices = new Set(
      await generateArray(
        prompt, 
        env, 
        z.number().int().min(0), // Schema for each array item
        {
          system: "You are a strict research analyst. Only include results that are relevant, reputable, current, and substantive.",
          temperature: 0.2,
          provider: "groq" // Use Llama model for cost savings
        }
      )
    );
    
    return results.filter((_, i) => relevantIndices.has(i));
  } catch (error) {
    console.error('Relevance assessment failed:', error);
    return results;
  }
}

// New function that implements batching for assessRelevance
export async function assessRelevanceWithBatching(
  query: string,
  results: ToolResult[],
  env: Env,
  batchSize: number = 3,
  maxParallelBatches: number = 2
): Promise<ToolResult[]> {
  // If results are fewer than the batch size, just use regular assessment
  if (results.length <= batchSize) {
    return assessRelevance(query, results, env);
  }
  
  const relevantResults: ToolResult[] = [];
  
  // Calculate how many batches we'll have
  const totalBatches = Math.ceil(results.length / batchSize);
  
  // Process batches with parallelization
  for (let batchStart = 0; batchStart < totalBatches; batchStart += maxParallelBatches) {
    // Determine how many batches to process in this parallel group
    const batchesToProcess = Math.min(maxParallelBatches, totalBatches - batchStart);
    
    // Create an array of promises for batch processing
    const batchPromises = Array.from({ length: batchesToProcess }, (_, i) => {
      const startIndex = (batchStart + i) * batchSize;
      const endIndex = Math.min(startIndex + batchSize, results.length);
      const batch = results.slice(startIndex, endIndex);
      return assessRelevance(query, batch, env);
    });
    
    // Wait for all batches in this group to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Collect relevant results from all batches
    batchResults.forEach(relevantBatch => {
      relevantResults.push(...relevantBatch);
    });
  }
  
  // If we've collected more than 2*batchSize results, do one final diversity pass
  if (relevantResults.length > batchSize * 2) {
    // For large result sets, use a larger batch size for final pass to ensure diversity
    const finalBatchSize = Math.min(relevantResults.length, 10);
    
    // Process in smaller chunks if still too large
    if (relevantResults.length > finalBatchSize) {
      return assessRelevanceWithBatching(query, relevantResults, env, finalBatchSize, maxParallelBatches);
    } else {
      return assessRelevance(query, relevantResults, env);
    }
  }
  
  return relevantResults;
}

// Helper function to analyze information gaps
export async function analyzeGaps(
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

Return a JSON object with gap analysis information.`;

  try {
    // Define schema for gap analysis
    const gapAnalysisSchema = z.object({
      hasGaps: z.boolean(),
      followUpQuery: z.string().nullable(),
      gapExplanation: z.string()
    });
    
    const gapAnalysis = await generateJSON(
      prompt, 
      env,
      gapAnalysisSchema,
      {
        system: "You analyze result completeness, identifying only critical information gaps that would substantially impact the answer. Be conservative - only suggest follow-up queries for major gaps.",
        temperature: 0.2,
        provider: "groq", // Use Llama model for cost savings
        schemaDescription: "Gap analysis for research results"
      }
    );
    
    if (gapAnalysis.hasGaps) {
      console.log(`Gap identified: ${gapAnalysis.gapExplanation}`);
    }
    
    return { 
      hasGaps: gapAnalysis.hasGaps, 
      followUpQuery: gapAnalysis.followUpQuery || undefined 
    };
  } catch (error) {
    console.error('Gap analysis failed:', error);
    return { hasGaps: false };
  }
}

// Helper function to analyze information gaps with batching
export async function analyzeGapsWithBatching(
  query: string,
  currentResults: ToolResult[],
  env: Env,
  batchSize: number = 5
): Promise<{ hasGaps: boolean; followUpQuery?: string }> {
  // If we have a small number of results, use regular gap analysis
  if (currentResults.length <= batchSize) {
    return analyzeGaps(query, currentResults, env);
  }
  
  // Batch the results
  const batches: ToolResult[][] = [];
  for (let i = 0; i < currentResults.length; i += batchSize) {
    batches.push(currentResults.slice(i, i + batchSize));
  }
  
  // Analyze gaps in each batch in parallel
  const batchGapAnalyses = await Promise.all(
    batches.map(batch => analyzeGaps(query, batch, env))
  );
  
  // Check if any batch has gaps
  const batchWithGaps = batchGapAnalyses.find(analysis => analysis.hasGaps);
  if (batchWithGaps) {
    return batchWithGaps;
  }
  
  // If no individual batch has gaps, do a final analysis with representative results
  // Select most important result from each batch
  const representativeResults: ToolResult[] = [];
  batches.forEach(batch => {
    // Find the highest confidence result in the batch
    const highestConfidenceResult = batch.reduce((best, current) => {
      const bestConfidence = best.metadata?.confidence || 0;
      const currentConfidence = current.metadata?.confidence || 0;
      return currentConfidence > bestConfidence ? current : best;
    }, batch[0]);
    
    representativeResults.push(highestConfidenceResult);
  });
  
  // Add some random results for diversity
  const remainingResults = currentResults.filter(r => !representativeResults.includes(r));
  const randomSample = remainingResults
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.min(batchSize, remainingResults.length));
  
  // Combine representative results with random sample for final analysis
  return analyzeGaps(query, [...representativeResults, ...randomSample], env);
}

// Function to synthesize results
export async function synthesizeResults(
  query: string,
  results: ToolResult[],
  env: Env
): Promise<string> {
  const synthesisPrompt = `Instructions for Creating a High-Quality Research Response:

1. Structure and Organization:
   - Begin with a concise introduction that frames the topic
   - Organize content into clear, themed sections with descriptive headers
   - Use bullet points or numbered lists for complex information
   - Conclude with a brief summary of key findings

2. Citation Requirements:
   - Use numbered citations in square brackets [1], [2], etc.
   - Every significant claim must be supported by at least one citation
   - Include a "Citations:" section at the end listing all references
   - When multiple sources support a claim, use multiple citations [1,2,3]

3. Formatting and Emphasis:
   - Use **bold text** for key concepts, terms, and technologies
   - Use *italics* for emphasis on important points
   - Maintain consistent formatting throughout
   - Use clear paragraph breaks for readability

4. Content Quality:
   - Directly address all aspects of the original query
   - Present balanced viewpoints with supporting evidence
   - Include specific examples and concrete details
   - Highlight both advantages and limitations
   - Use precise, technical language while remaining accessible

5. Source Integration:
   - Synthesize information across multiple sources
   - Compare and contrast different viewpoints when relevant
   - Highlight areas of consensus and disagreement in the field
   - Include relevant statistics and quantitative data when available

6. Technical Accuracy:
   - Verify technical claims across multiple sources
   - Include relevant equations or formulas if necessary
   - Explain complex concepts in clear, precise terms
   - Acknowledge uncertainties or limitations in current knowledge

7. Currency and Relevance:
   - Prioritize recent developments and current state of the field
   - Include historical context when relevant
   - Address future implications and ongoing challenges
   - Note emerging trends and potential developments

Please synthesize the research results into a comprehensive response following these guidelines, maintaining a professional and authoritative tone throughout.`;

  const fullPrompt = `${synthesisPrompt}

Query: "${query}"

Results:
${results.map((r, i) => `
Result ${i + 1}:
${JSON.stringify(r.data, null, 2)}`).join('\n')}`;

  try {
    return await callLLM(fullPrompt, env, {
      system: "You synthesize research results into clear, well-structured answers with proper citations.",
      temperature: 0.5
    });
  } catch (error) {
    console.error('Results synthesis failed:', error);
    return `Unable to synthesize results. Found ${results.length} relevant results.`;
  }
}

// Function to extract sources from results
export function extractSources(results: ToolResult[], tools: ToolCard[]): Array<{
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
            id: (index * 100) + itemIndex + 1,
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

  return sources.sort((a, b) => a.id - b.id);
}

// Function to calculate confidence score
export function calculateConfidence(
  results: ToolResult[], 
  analysis: QueryAnalysis, 
  synthesizedAnswer: string
): number {
  // Base calculations
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length === 0) return 0;
  
  // Source quality evaluation
  const sourceQuality = evaluateSourceQuality(successfulResults);
  
  // Content relevance and quality
  const contentQuality = evaluateContentQuality(synthesizedAnswer, analysis);
  
  // Citation and evidence quality
  const citationQuality = evaluateCitations(synthesizedAnswer);
  
  // Final weighted calculation
  const confidenceScore = Math.min(
    0.4 * sourceQuality + 
    0.4 * contentQuality + 
    0.2 * citationQuality,
    1.0
  );
  
  // Store diagnostic data
  logConfidenceMetadata(successfulResults, sourceQuality, contentQuality, citationQuality);
  
  return confidenceScore;
}

// Helper function to evaluate source quality
function evaluateSourceQuality(results: ToolResult[]): number {
  // Calculate base confidence from results
  const avgConfidence = results.reduce(
    (sum, r) => sum + (r.metadata?.confidence || 0.5), 0
  ) / results.length;
  
  // Calculate source diversity
  const uniqueUrls = new Set(
    results.flatMap(r => {
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
    results.map(r => r.metadata?.toolType).filter(Boolean)
  ).size;
  
  const sourceDiversity = Math.min((uniqueUrls / 2) + (uniqueToolTypes / 3), 1.0);
  
  return (avgConfidence * 0.6) + (sourceDiversity * 0.4);
}

// Helper function to evaluate content quality
function evaluateContentQuality(answer: string, analysis: QueryAnalysis): number {
  // Structure quality
  const structureScore = evaluateStructure(answer);
  
  // Formatting quality
  const formattingScore = evaluateFormatting(answer);
  
  // Content quality indicators
  const qualityScore = evaluateQualityIndicators(answer);
  
  // Entity and query type coverage
  const coverageScore = evaluateCoverage(answer, analysis);
  
  return (structureScore * 0.3) + (formattingScore * 0.2) + 
         (qualityScore * 0.2) + (coverageScore * 0.3);
}

// Helper function to evaluate structure
function evaluateStructure(answer: string): number {
  const hasSections = {
    introduction: /(?:^|\n)###?\s*Introduction/i.test(answer),
    conclusion: /(?:^|\n)###?\s*Conclusion/i.test(answer),
    citations: /(?:^|\n)###?\s*(?:Citations|References):/i.test(answer),
    mainContent: (answer.match(/(?:^|\n)###?\s+[^#\n]+/g) || []).length >= 2
  };
  
  return Object.values(hasSections).filter(Boolean).length / 4;
}

// Helper function to evaluate formatting
function evaluateFormatting(answer: string): number {
  const formatting = {
    boldText: (answer.match(/\*\*[^*]+\*\*/g) || []).length >= 3,
    lists: /(?:^|\n)\s*[-*]\s+|\d+\.\s+/m.test(answer),
    headers: (answer.match(/(?:^|\n)#{1,3}\s+[^#\n]+/g) || []).length >= 2,
    paragraphs: answer.split(/\n\n+/).length >= 3
  };
  
  return Object.values(formatting).filter(Boolean).length / 4;
}

// Helper function to evaluate quality indicators
function evaluateQualityIndicators(answer: string): number {
  const quality = {
    keyTermsBolded: (answer.match(/\*\*[^*]+\*\*/g) || []).length >= 5,
    properParagraphs: answer.split(/\n\n+/).length >= 4,
    consistentFormatting: !/(#{1,3}\s*$|\*\*\s*\*\*)/m.test(answer),
    meaningfulSections: (answer.match(/(?:^|\n)###?\s+[^#\n]{10,}/g) || []).length >= 2
  };
  
  return Object.values(quality).filter(Boolean).length / 4;
}

// Helper function to evaluate citations
function evaluateCitations(answer: string): number {
  const citationPatterns = [
    /\[(\d+(?:,\s*\d+)*)\]/g,    // Standard [1] format
    /\[([a-zA-Z][^[\]]*)\]/g,    // [AuthorYear] format
    /\(([^()]*\d{4}[^()]*)\)/g,  // (Author et al., 2023) format
    /\[Source\]/g,               // [Source] format
    /\[\d+\]:/g                  // [1]: format (bibliography style)
  ];
  
  const citationCount = citationPatterns.reduce((count, pattern) => {
    const matches = answer.match(pattern) || [];
    return count + matches.length;
  }, 0);
  
  const wordCount = answer.split(/\s+/).length;
  return Math.min(
    (citationCount / Math.max(Math.floor(wordCount / 100), 1)) * 2,
    1.0
  );
}

// Helper function to evaluate entity and query type coverage
function evaluateCoverage(answer: string, analysis: QueryAnalysis): number {
  const lowerAnswer = answer.toLowerCase();
  
  // Check entity coverage
  const entityCoverage = analysis.entities.length > 0
    ? analysis.entities.filter(entity => 
        lowerAnswer.includes(entity.toLowerCase())
      ).length / analysis.entities.length
    : 0.7; // Default if no entities
  
  // Check query type coverage
  const queryTypeCoverage = analysis.queryTypes.length > 0
    ? analysis.queryTypes.filter(type => {
        switch (type.toLowerCase()) {
          case 'comparison':
            return /compar|versus|vs\.|better|worse|differ/i.test(answer);
          case 'factual':
            return /\b(is|are|was|were|fact|specifically)\b/i.test(answer);
          case 'explanation':
            return /\b(because|therefore|thus|hence|explain|reason)\b/i.test(answer);
          case 'howto':
            return /\b(step|guide|how to|process|method)\b/i.test(answer);
          case 'opinion':
            return /\b(recommend|suggest|believe|opinion|consider)\b/i.test(answer);
          default:
            return true;
        }
      }).length / analysis.queryTypes.length
    : 0.7; // Default if no query types
  
  // Check if answer aligns with query intent
  const intentAlignment = typeof analysis.intent === 'string' && analysis.intent.length > 0
    ? Number(answer.toLowerCase().includes(analysis.intent.toLowerCase()))
    : 0.7; // Default if no intent
  
  return (entityCoverage * 0.4) + (queryTypeCoverage * 0.3) + (intentAlignment * 0.3);
}

// Helper function to log confidence metadata
function logConfidenceMetadata(
  results: ToolResult[],
  sourceQuality: number,
  contentQuality: number,
  citationQuality: number
): void {
  if (results.length > 0) {
    const metadata = {
      sourceQuality,
      contentQuality,
      citationQuality,
      timestamp: new Date().toISOString()
    };
    
    results[0].metadata = {
      ...(results[0].metadata || {}),
      confidenceCalculation: metadata
    };
  }
} 