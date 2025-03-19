import { QueryAnalysis, Env } from './types';
import { callLLM } from './utils';

// Extract URLs and YouTube URLs (keep these regex-based for efficiency)
function extractUrls(query: string): string[] {
  return query.match(/(https?:\/\/[^\s]+)/g) || [];
}

function extractYouTubeUrls(query: string): string[] {
  return query.match(/(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g) || [];
}

// Consolidated LLM-powered query analysis
export async function analyzeQuery(query: string, env: Env): Promise<QueryAnalysis> {
  // Extract URLs with regex
  const extractedUrls = extractUrls(query);
  const extractedYouTubeUrls = extractYouTubeUrls(query);
  
  // Use LLM for advanced analysis
  const prompt = `
Analyze this search query and extract structured information in JSON format:

Query: "${query}"

Return ONLY this JSON structure:
{
  "intent": "search|explain|compare|implement|extract",
  "entities": ["entity1", "entity2"],
  "queryTypes": ["technical|current_events|general_knowledge|comparison|implementation|content_extraction|video_content"],
  "constraints": ["constraint1", "constraint2"]
}`;

  try {
    const llmResult = await callLLM(prompt, env, {
      system: "You extract structured information from search queries, returning only valid JSON.",
      temperature: 0.2
    });
    
    const parsedResult = JSON.parse(llmResult);
    
    // Calculate confidence
    let confidence = 0.7;
    confidence += Math.min((parsedResult.entities?.length || 0) * 0.05, 0.1);
    confidence += Math.min((parsedResult.queryTypes?.length || 0) * 0.05, 0.1);
    confidence += Math.min((parsedResult.constraints?.length || 0) * 0.05, 0.1);
    
    return {
      originalQuery: query,
      intent: parsedResult.intent || 'search',
      entities: parsedResult.entities || [],
      constraints: parsedResult.constraints || [],
      queryTypes: parsedResult.queryTypes || [],
      extractedUrls,
      extractedYouTubeUrls,
      confidence: Math.min(confidence, 1.0)
    };
  } catch (error) {
    console.error('LLM analysis failed:', error);
    
    // Fallback using basic pattern matching
    return {
      originalQuery: query,
      intent: query.match(/(explain|how|why|what is|describe)/i) ? 'explain' : 
             query.match(/(compare|versus|vs|better|difference)/i) ? 'compare' :
             query.match(/(implement|create|build|code|develop)/i) ? 'implement' :
             query.match(/(extract|get|pull|scrape|download)/i) ? 'extract' : 'search',
      entities: extractEntitiesBasic(query),
      constraints: extractConstraintsBasic(query),
      queryTypes: identifyQueryTypesBasic(query),
      extractedUrls,
      extractedYouTubeUrls,
      confidence: 0.5
    };
  }
}

// Simplified fallback functions
function extractEntitiesBasic(query: string): string[] {
  const patterns = [
    /(javascript|typescript|python|react|node\.js|angular|vue|docker|kubernetes|aws|azure|git|github)/gi,
    /(function|class|method|api|framework|library|package|module|component)/gi,
    /(google|microsoft|amazon|facebook|twitter|youtube|github)/gi
  ];
  
  return [...new Set(
    patterns.flatMap(pattern => query.match(pattern) || [])
      .map(e => e.toLowerCase())
  )];
}

function extractConstraintsBasic(query: string): string[] {
  const patterns = [
    /language:\s*([a-zA-Z]+)/gi,
    /(last|past|recent|within)\s+\d+\s+(day|week|month|year)s?/gi,
    /\b\d+\s+(result|item|example)s?\b/gi
  ];
  
  return patterns.flatMap(pattern => query.match(pattern) || []);
}

function identifyQueryTypesBasic(query: string): string[] {
  const typePatterns = {
    'technical': /(code|programming|algorithm|implementation|api|framework|library)/i,
    'current_events': /(news|latest|recent|update|current)/i,
    'general_knowledge': /(what is|how does|explain|define|meaning of)/i,
    'comparison': /(compare|versus|vs|difference between|better)/i,
    'implementation': /(implement|create|build|develop|code)/i,
    'content_extraction': /(extract|scrape|crawl|content from)/i,
    'video_content': /(video|youtube|watch|stream)/i
  };
  
  return Object.entries(typePatterns)
    .filter(([_, pattern]) => pattern.test(query))
    .map(([type, _]) => type);
}
