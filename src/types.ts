export interface Env {
  // Required by workers-mcp
  SHARED_SECRET: string;

  // API Keys
  BRAVE_API_KEY: string;
  TAVILY_API_KEY: string;
  GITHUB_TOKEN: string;
  FIRE_CRAWL_API_KEY: string;
  OPENAI_API_KEY?: string;
  
  // Optional Workers AI binding
  AI?: any;
  
  // Optional caching
  RESEARCH_CACHE?: KVNamespace;
}

export interface QueryAnalysis {
  originalQuery: string;
  intent: string;
  entities: string[];
  constraints: string[];
  queryTypes: string[];
  extractedUrls: string[];
  extractedYouTubeUrls: string[];
  confidence: number;
}

export interface DemoCommand {
  command: string;
  description: string;
}

export interface ToolCard {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  inputTypes: Record<string, string>;
  outputType: string;
  demoCommands: DemoCommand[];
  metadata: {
    limitations: string[];
    bestPractices: string[];
  };
  compatibilityMetadata: {
    queryTypes: Record<string, number>;
    patterns: string[];
    urlCompatible: boolean;
    entityTypes: string[];
  };
  relevanceScore: (query: string, analysis: QueryAnalysis) => number;
  execute: (params: ToolParams, env: Env) => Promise<ToolResult>;
}

export interface ToolParams {
  query?: string;
  url?: string;
  maxResults?: number;
  videoId?: string;
  searchType?: 'search' | 'news';
  language?: string;
  [key: string]: any;
}

export interface ToolResult {
  success: boolean;
  data: any;
  error?: string;
  metadata?: {
    confidence?: number;
    executionTime?: number;
    attempts?: number;
    lastError?: string;
    [key: string]: any;
  };
}

export interface Source {
  id: number;
  tool: string;
  url?: string;
  title?: string;
  metadata?: Record<string, any>;
}

export interface ResearchResult {
  answer: string;
  sources: Source[];
  confidence: number;
  metadata: {
    executionTime: number;
    toolsUsed: string[];
    queryTypes: string[];
    toolResults: Array<{
      tool: string;
      success: boolean;
      confidence: number;
    }>;
    [key: string]: any;
  };
}
