import { ToolResult, QueryAnalysis, Env, ToolCard } from './types';
import { callLLM } from './utils';

// Helper function to assess result relevance
export async function assessRelevance(
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

// Function to synthesize results
export async function synthesizeResults(
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