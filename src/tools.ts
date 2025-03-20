import { ToolCard, ToolParams, ToolResult, Env, QueryAnalysis } from './types';

// Utility function for calculating relevance scores
function calculateRelevanceScore(
  patterns: string[],
  queryTypes: Record<string, number>,
  entityTypes: string[],
  query: string,
  analysis: QueryAnalysis,
  urlCheck?: (urls: string[]) => boolean
): number {
  let score = 0;
  
  // Pattern matching
  const hasPattern = patterns.some(pattern => 
    query.toLowerCase().includes(pattern.toLowerCase())
  );
  score += hasPattern ? 0.3 : 0;
  
  // Query type compatibility
  const typeScore = Math.max(
    ...analysis.queryTypes.map(type => queryTypes[type] || 0)
  );
  score += typeScore * 0.3;
  
  // Entity compatibility
  const hasRelevantEntity = analysis.entities.some(entity =>
    entityTypes.includes(entity)
  );
  score += hasRelevantEntity ? 0.2 : 0;
  
  // URL check if provided
  if (urlCheck) {
    score += urlCheck(analysis.extractedUrls) ? 0.2 : 0;
  }
  
  return Math.min(score, 1.0);
}

// Utility function for standardized error handling
function handleToolError(error: unknown, startTime?: number): ToolResult {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
  return {
    success: false,
    data: null,
    error: errorMessage,
    ...(startTime && {
      metadata: {
        executionTime: Date.now() - startTime
      }
    })
  };
}

// Utility function for successful response handling
function handleToolSuccess(data: any, startTime: number, confidence = 0.8): ToolResult {
  return {
    success: true,
    data,
    metadata: {
      executionTime: Date.now() - startTime,
      confidence
    }
  };
}

// Brave Search Tool
export const braveSearch: ToolCard = {
  id: 'brave_search',
  name: 'Brave Search',
  description: 'Search the web using Brave Search API with privacy focus',
  capabilities: ['web_search', 'privacy_focused', 'general_knowledge'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results to return (default: 10)'
  },
  outputType: 'List of search results with title, URL, and description',
  demoCommands: [
    {
      command: 'braveSearch({ query: "typescript best practices" })',
      description: 'Search for TypeScript best practices'
    }
  ],
  metadata: {
    limitations: [
      'Rate limited by API key',
      'Maximum 20 results per request'
    ],
    bestPractices: [
      'Use specific search terms',
      'Include relevant keywords'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'general_knowledge': 0.8,
      'current_events': 0.8,
      'technical': 0.6
    },
    patterns: [
      'search', 'find', 'look up', 'what is', 'how to',
      'where', 'when', 'who', 'why'
    ],
    urlCompatible: false,
    entityTypes: ['person', 'organization', 'location', 'technology', 'concept']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.append('q', params.query);
      url.searchParams.append('count', (params.maxResults || 10).toString());

      const response = await fetch(url, {
        headers: { 
          'Accept': 'application/json',
          'X-Subscription-Token': env.BRAVE_API_KEY
        }
      });

      if (!response.ok) {
        throw new Error(`Brave Search API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.8);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Tavily Search Tool
export const tavilySearch: ToolCard = {
  id: 'tavily_search',
  name: 'Tavily Search',
  description: 'AI-powered search using Tavily API for enhanced relevance',
  capabilities: ['ai_search', 'semantic_understanding', 'news_search'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results (default: 5)',
    searchType: 'Type of search - "search" or "news"'
  },
  outputType: 'AI-enhanced search results with relevance scores',
  demoCommands: [
    {
      command: 'tavilySearch({ query: "latest AI developments", searchType: "news" })',
      description: 'Search for latest AI news'
    }
  ],
  metadata: {
    limitations: [
      'API rate limits apply',
      'News search limited to recent articles'
    ],
    bestPractices: [
      'Use natural language queries',
      'Specify search type for better results'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'current_events': 0.9,
      'technical': 0.8,
      'general_knowledge': 0.7
    },
    patterns: [
      'latest', 'news', 'recent', 'current', 'development',
      'breakthrough', 'update'
    ],
    urlCompatible: false,
    entityTypes: ['person', 'organization', 'technology', 'event']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'api-key': env.TAVILY_API_KEY
        },
        body: JSON.stringify({
          query: params.query,
          max_results: params.maxResults || 5,
          search_type: params.searchType || 'search'
        })
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// GitHub Repository Search Tool
export const githubRepoSearch: ToolCard = {
  id: 'github_repo_search',
  name: 'GitHub Repository Search',
  description: 'Search for GitHub repositories with detailed metadata',
  capabilities: ['repository_search', 'code_discovery', 'project_analysis'],
  inputTypes: {
    query: 'Search query for repositories',
    maxResults: 'Maximum number of repositories to return (default: 5)'
  },
  outputType: 'List of repositories with metadata (stars, language, description)',
  demoCommands: [
    {
      command: 'githubRepoSearch({ query: "typescript orm stars:>1000" })',
      description: 'Find popular TypeScript ORMs'
    }
  ],
  metadata: {
    limitations: [
      'GitHub API rate limits apply',
      'Search syntax requirements'
    ],
    bestPractices: [
      'Use specific search qualifiers',
      'Include language or topic filters'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'technical': 0.9,
      'code_related': 0.9,
      'general_knowledge': 0.3
    },
    patterns: [
      'github', 'repository', 'repo', 'code', 'library',
      'framework', 'package', 'project'
    ],
    urlCompatible: false,
    entityTypes: ['technology', 'programming_language', 'framework', 'library']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }
      if (!env.GITHUB_TOKEN) {
        throw new Error('GitHub token is not configured');
      }

      const startTime = Date.now();
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.append('q', params.query);
      url.searchParams.append('per_page', (params.maxResults || 5).toString());

      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'mcp-research-tool'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('GitHub API error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.8);
    } catch (error: unknown) {
      console.error('GitHub search error:', error);
      return handleToolError(error);
    }
  }
};

// GitHub Code Search Tool
export const githubCodeSearch: ToolCard = {
  id: 'github_code_search',
  name: 'GitHub Code Search',
  description: 'Search for code snippets across GitHub repositories',
  capabilities: ['code_search', 'pattern_matching', 'language_specific_search'],
  inputTypes: {
    query: 'Code search query',
    maxResults: 'Maximum number of results (default: 5)'
  },
  outputType: 'List of code snippets with repository and file information',
  demoCommands: [
    {
      command: 'githubCodeSearch({ query: "language:typescript express middleware" })',
      description: 'Find TypeScript Express middleware examples'
    }
  ],
  metadata: {
    limitations: [
      'GitHub API rate limits',
      'Code-specific search syntax required'
    ],
    bestPractices: [
      'Use language qualifiers',
      'Include specific function names or patterns'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'technical': 0.9,
      'code_related': 0.9,
      'implementation': 0.8
    },
    patterns: [
      'code', 'implementation', 'example', 'function',
      'class', 'method', 'pattern'
    ],
    urlCompatible: false,
    entityTypes: ['programming_language', 'framework', 'library', 'function']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const url = new URL('https://api.github.com/search/code');
      url.searchParams.append('q', params.query);
      url.searchParams.append('per_page', (params.maxResults || 5).toString());

      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'mcp-research-tool'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub Code Search API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.8);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Fire Crawl Tool
export const fireCrawl: ToolCard = {
  id: 'fire_crawl',
  name: 'Fire Crawl',
  description: 'Extract and analyze content from web pages',
  capabilities: ['web_scraping', 'content_extraction', 'text_analysis'],
  inputTypes: {
    url: 'URL to crawl and extract content from'
  },
  outputType: 'Structured content from webpage including text and metadata',
  demoCommands: [
    {
      command: 'fireCrawl({ url: "https://example.com/article" })',
      description: 'Extract content from a webpage'
    }
  ],
  metadata: {
    limitations: [
      'Some sites may block crawling',
      'JavaScript-rendered content limitations'
    ],
    bestPractices: [
      'Respect robots.txt',
      'Handle rate limiting appropriately'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'content_extraction': 0.9,
      'article_analysis': 0.8,
      'technical': 0.6
    },
    patterns: [
      'extract', 'crawl', 'scrape', 'content',
      'article', 'page', 'website'
    ],
    urlCompatible: true,
    entityTypes: ['webpage', 'article', 'blog_post']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis,
      urls => urls.length > 0 // URL presence check (highly relevant for crawling)
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.url) {
        throw new Error('URL parameter is required');
      }

      const startTime = Date.now();
      const response = await fetch('https://api.firecrawl.com/extract', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.FIRE_CRAWL_API_KEY}`
        },
        body: JSON.stringify({ url: params.url })
      });

      if (!response.ok) {
        throw new Error(`Fire Crawl API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.8);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// YouTube Transcript Tool
export const youtubeTranscript: ToolCard = {
  id: 'youtube_transcript',
  name: 'YouTube Transcript Tool',
  description: 'Extract transcripts from YouTube videos',
  capabilities: ['Extract transcripts from YouTube videos', 'Process video content'],
  inputTypes: {
    videoId: 'YouTube video ID or URL',
    language: 'Optional language code (default: en)'
  },
  outputType: 'Video transcript text',
  demoCommands: [{
    command: 'Get transcript for video dQw4w9WgXcQ',
    description: 'Extracts the transcript from the specified YouTube video'
  }],
  metadata: {
    limitations: [
      'Only works with videos that have captions',
      'Some videos may have auto-generated captions only'
    ],
    bestPractices: [
      'Provide video ID directly when possible',
      'Specify language if non-English transcript needed'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'video_content': 0.9,
      'technical': 0.7,
      'educational': 0.8
    },
    patterns: [
      'youtube', 'video', 'transcript', 'caption',
      'lecture', 'talk', 'presentation'
    ],
    urlCompatible: true,
    entityTypes: ['video', 'youtube']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis,
      urls => urls.some(url => url.includes('youtube.com') || url.includes('youtu.be'))
    );
  },
  
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.videoId) {
        throw new Error('Video ID parameter is required');
      }

      const startTime = Date.now();
      
      const response = await fetch(`https://www.youtube.com/watch?v=${params.videoId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }

      const text = await response.text();
      const dataRegex = /var ytInitialPlayerResponse = (\{.*?\});/;
      const match = text.match(dataRegex);

      if (!match || !match[1]) {
        throw new Error('Could not find transcript data');
      }

      const data = JSON.parse(match[1]);
      const transcript = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      return handleToolSuccess(transcript, startTime);
    } catch (error) {
      return handleToolError(error);
    }
  }
};

// arXiv Research Tool
export const arXivSearch: ToolCard = {
  id: 'arxiv_search',
  name: 'arXiv Search',
  description: 'Search academic papers and preprints from arXiv repository',
  capabilities: ['academic_search', 'research_papers', 'scientific_literature'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results to return (default: 10)',
    sortBy: 'Sort results by: relevance, lastUpdatedDate, submitted (default: relevance)'
  },
  outputType: 'List of academic papers with titles, authors, abstracts, and links',
  demoCommands: [
    {
      command: 'arXivSearch({ query: "quantum computing", maxResults: 5 })',
      description: 'Search for recent quantum computing papers'
    }
  ],
  metadata: {
    limitations: [
      'Rate limited to 1 request per 3 seconds',
      'Returns only academic papers and preprints',
      'Limited to papers submitted to arXiv'
    ],
    bestPractices: [
      'Use specific scientific terms',
      'Include field-specific keywords',
      'Use boolean operators (AND, OR, NOT)',
      'Use field-specific searches (e.g., "ti:" for title)'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'academic': 0.9,
      'scientific': 0.9,
      'technical': 0.8,
      'research': 0.9,
      'general_knowledge': 0.4
    },
    patterns: [
      'research', 'paper', 'study', 'academic', 'scientific',
      'journal', 'publication', 'preprint', 'arxiv',
      'theory', 'experiment', 'methodology'
    ],
    urlCompatible: false,
    entityTypes: [
      'researcher', 'scientific_concept', 'theory',
      'methodology', 'academic_field', 'technology'
    ]
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const baseUrl = 'http://export.arxiv.org/api/query';
      const searchQuery = new URLSearchParams({
        search_query: params.query,
        max_results: String(params.maxResults || 10),
        sortBy: params.sortBy || 'relevance'
      }).toString();

      const response = await fetch(`${baseUrl}?${searchQuery}`, {
        headers: {
          'Accept': 'application/xml',
          'User-Agent': 'mcp-research-tool/1.0 (https://github.com/objones25/mcp-research-tool)'
        }
      });

      if (!response.ok) {
        throw new Error(`arXiv API error: ${response.statusText}`);
      }

      const xmlText = await response.text();
      
      // Simple XML parsing to extract key information
      const papers = xmlText.match(/<entry>(.*?)<\/entry>/gs) || [];
      const results = papers.map(paper => {
        const getTag = (tag: string) => {
          const match = paper.match(new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 's'));
          return match ? match[1].trim() : '';
        };
        
        const authors = paper.match(/<author>(.*?)<\/author>/gs)?.map(author => {
          const match = author.match(/<n>(.*?)<\/n>/);
          return match ? match[1].trim() : '';
        }) || [];

        return {
          title: getTag('title'),
          authors: authors,
          summary: getTag('summary'),
          published: getTag('published'),
          updated: getTag('updated'),
          doi: getTag('doi'),
          link: (paper.match(/<id>(.*?)<\/id>/) || [])[1] || '',
          categories: paper.match(/term="([^"]+)"/g)?.map(t => t.slice(6, -1)) || []
        };
      });

      return handleToolSuccess({
        papers: results,
        totalResults: results.length,
        query: params.query
      }, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// News API Tool
export const newsApiSearch: ToolCard = {
  id: 'news_api_search',
  name: 'News API Search',
  description: 'Search worldwide news articles from over 80,000 sources using the News API',
  capabilities: ['news_search', 'current_events', 'media_monitoring'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results (default: 10)',
    sortBy: 'Sort articles by: relevancy, popularity, publishedAt (default: publishedAt)',
    language: 'Optional 2-letter ISO language code (e.g., en)',
    from: 'Optional start date (YYYY-MM-DD). Note: Free tier is limited to last 30 days only. For best results, omit date filters to get current news',
    to: 'Optional end date (YYYY-MM-DD)'
  },
  outputType: 'List of news articles with title, description, source, and URL',
  demoCommands: [
    {
      command: 'newsApiSearch({ query: "artificial intelligence", sortBy: "popularity" })',
      description: 'Search for current AI news without date filters'
    }
  ],
  metadata: {
    limitations: [
      'Free tier is limited to: 100 requests per day, Articles from the last 30 days only, No historical article access (requires paid plan)',
      'Rate limited to 1 request per second',
      'Results may be delayed by up to 1 hour'
    ],
    bestPractices: [
      'Use specific search terms',
      'For free tier, ensure date range is within last 30 days',
      'Combine with language filters for better relevance',
      'Omit date filters for current news'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'current_events': 0.9,
      'news': 0.9,
      'media': 0.8,
      'general_knowledge': 0.7
    },
    patterns: [
      'news', 'article', 'latest', 'recent', 'current',
      'today', 'headlines', 'press', 'media', 'report'
    ],
    urlCompatible: false,
    entityTypes: ['event', 'person', 'organization', 'location', 'topic']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }
      if (!env.NEWS_API_KEY) {
        throw new Error('News API key is not configured');
      }

      const startTime = Date.now();
      const url = new URL('https://newsapi.org/v2/everything');
      url.searchParams.append('q', params.query);
      url.searchParams.append('pageSize', (params.maxResults || 10).toString());
      url.searchParams.append('sortBy', params.sortBy || 'publishedAt');
      
      if (params.language) {
        url.searchParams.append('language', params.language);
      }
      if (params.from) {
        url.searchParams.append('from', params.from);
      }
      if (params.to) {
        url.searchParams.append('to', params.to);
      }

      const response = await fetch(url, {
        headers: {
          'X-Api-Key': env.NEWS_API_KEY,
          'User-Agent': 'mcp-research-tool'
        }
      });

      if (!response.ok) {
        throw new Error(`News API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Stack Exchange API Tool
export const stackExchangeSearch: ToolCard = {
  id: 'stack_exchange_search',
  name: 'Stack Exchange Search',
  description: 'Search Stack Exchange network sites (primarily Stack Overflow) for technical questions and answers',
  capabilities: ['technical_qa', 'programming_help', 'developer_knowledge'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results (default: 10)',
    site: 'Stack Exchange site (default: stackoverflow)',
    sort: 'Sort by: activity, votes, creation, relevance (default: relevance)',
    tagged: 'Optional comma separated list of tags'
  },
  outputType: 'List of questions with answers, vote counts, and metadata',
  demoCommands: [
    {
      command: 'stackExchangeSearch({ query: "typescript generics", tagged: "typescript" })',
      description: 'Search for TypeScript generics questions'
    }
  ],
  metadata: {
    limitations: [
      'API quota limits apply',
      'Some features require authentication',
      'Results may be cached'
    ],
    bestPractices: [
      'Include relevant tags',
      'Use specific technical terms',
      'Filter by score for quality answers'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'technical': 0.9,
      'programming': 0.9,
      'question_answer': 0.8,
      'problem_solving': 0.8
    },
    patterns: [
      'how to', 'error', 'problem', 'issue', 'debug',
      'stackoverflow', 'stack overflow', 'solution',
      'example', 'help', 'question'
    ],
    urlCompatible: false,
    entityTypes: ['programming_language', 'framework', 'library', 'error', 'concept']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const url = new URL('https://api.stackexchange.com/2.3/search');
      url.searchParams.append('site', params.site || 'stackoverflow');
      url.searchParams.append('intitle', params.query);
      url.searchParams.append('pagesize', (params.maxResults || 10).toString());
      url.searchParams.append('sort', params.sort || 'relevance');
      url.searchParams.append('filter', 'withbody');
      
      if (params.tagged) {
        url.searchParams.append('tagged', params.tagged);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Stack Exchange API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Wikipedia API Tool
export const wikipediaSearch: ToolCard = {
  id: 'wikipedia_search',
  name: 'Wikipedia Search',
  description: 'Search Wikipedia articles and retrieve structured content',
  capabilities: ['encyclopedia', 'general_knowledge', 'factual_information'],
  inputTypes: {
    query: 'Search query string',
    limit: 'Maximum number of results (default: 5)',
    language: 'Wikipedia language edition (default: en)'
  },
  outputType: 'List of Wikipedia articles with summaries, extracts, and URLs',
  demoCommands: [
    {
      command: 'wikipediaSearch({ query: "quantum physics" })',
      description: 'Search for Wikipedia articles about quantum physics'
    }
  ],
  metadata: {
    limitations: [
      'Rate limited to prevent abuse',
      'Content may vary across language editions',
      'Article availability depends on topic coverage',
      'May contain inaccuracies or bias as content is community-edited',
      'Not always suitable as a sole authoritative source',
      'Information may be outdated or incomplete'
    ],
    bestPractices: [
      'Use specific search terms',
      'Specify language for non-English queries',
      'Use for factual information rather than opinions',
      'Verify critical information with specialized or primary sources',
      'Check article references and citations for reliability'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'general_knowledge': 0.9,
      'factual_information': 0.9,
      'historical': 0.8,
      'scientific': 0.7,
      'biographical': 0.8
    },
    patterns: [
      'what is', 'who is', 'define', 'explain', 'wikipedia',
      'meaning', 'encyclopedia', 'information about', 'history of'
    ],
    urlCompatible: false,
    entityTypes: ['person', 'location', 'organization', 'concept', 'event', 'scientific_term']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      const language = params.language || 'en';
      const limit = params.limit || 5;
      
      // First make a search request to get page IDs
      const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.append('action', 'query');
      searchUrl.searchParams.append('list', 'search');
      searchUrl.searchParams.append('srsearch', params.query);
      searchUrl.searchParams.append('srlimit', limit.toString());
      searchUrl.searchParams.append('format', 'json');
      searchUrl.searchParams.append('origin', '*');

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        throw new Error(`Wikipedia search API error: ${searchResponse.statusText}`);
      }

      const searchData = await searchResponse.json() as { 
        query: { search: Array<{ pageid: number }> } 
      };
      const pageIds = searchData.query.search.map((result) => result.pageid);
      
      if (pageIds.length === 0) {
        return handleToolSuccess({
          query: params.query,
          results: []
        }, startTime, 0.8);
      }

      // Get detailed content for each page
      const contentUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
      contentUrl.searchParams.append('action', 'query');
      contentUrl.searchParams.append('pageids', pageIds.join('|'));
      contentUrl.searchParams.append('prop', 'extracts|info|categories|images|links');
      contentUrl.searchParams.append('exintro', '1');
      contentUrl.searchParams.append('explaintext', '1');
      contentUrl.searchParams.append('inprop', 'url');
      contentUrl.searchParams.append('format', 'json');
      contentUrl.searchParams.append('origin', '*');

      const contentResponse = await fetch(contentUrl);
      if (!contentResponse.ok) {
        throw new Error(`Wikipedia content API error: ${contentResponse.statusText}`);
      }

      const contentData = await contentResponse.json() as {
        query: {
          pages: Record<string, {
            title: string;
            extract: string;
            fullurl: string;
            pageid: number;
            touched: string;
            categories?: Array<{ title: string }>;
            images?: Array<any>;
          }>;
        };
      };
      const pages = contentData.query.pages;
      
      const results = Object.values(pages).map((page) => ({
        title: page.title,
        extract: page.extract,
        url: page.fullurl,
        pageid: page.pageid,
        lastModified: page.touched,
        categories: page.categories ? page.categories.map((cat) => cat.title) : [],
        imageCount: page.images ? page.images.length : 0
      }));

      return handleToolSuccess({
        query: params.query,
        results: results
      }, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// PatentsView API Tool
export const patentSearch: ToolCard = {
  id: 'patent_search',
  name: 'Patent Search',
  description: 'Search for patents using the PatentsView API',
  capabilities: ['patent_search', 'intellectual_property', 'innovation_tracking'],
  inputTypes: {
    query: 'Search query string',
    maxResults: 'Maximum number of results (default: 10)',
    fields: 'Optional comma-separated list of fields to return',
    startDate: 'Optional start date (YYYY-MM-DD)',
    endDate: 'Optional end date (YYYY-MM-DD)'
  },
  outputType: 'List of patents with title, inventors, assignees, dates, and classifications',
  demoCommands: [
    {
      command: 'patentSearch({ query: "machine learning", maxResults: 5 })',
      description: 'Search for machine learning patents'
    }
  ],
  metadata: {
    limitations: [
      'Rate limited to 45 requests per minute per API key',
      'Maximum of 1000 results per query',
      'Some data fields may be unavailable for older patents'
    ],
    bestPractices: [
      'Use specific technical terms',
      'Filter by date range for more relevant results',
      'Use CPC classification codes when possible for precise searches'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'technical': 0.8,
      'innovation': 0.9,
      'intellectual_property': 0.9,
      'research': 0.7
    },
    patterns: [
      'patent', 'invention', 'innovate', 'intellectual property', 'IP',
      'technology', 'inventor', 'assignee', 'USPTO'
    ],
    urlCompatible: false,
    entityTypes: ['technology', 'invention', 'company', 'person']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }
      if (!env.PATENTSVIEW_API_KEY) {
        throw new Error('PatentsView API key is not configured');
      }

      const startTime = Date.now();
      const baseUrl = 'https://api.patentsview.org/patents/query';
      
      // Build query structure according to PatentsView API format
      const requestBody: any = {
        q: {
          _or: [
            { _text_any: { patent_title: params.query } },
            { _text_all: { patent_abstract: params.query } }
          ]
        },
        f: params.fields ? params.fields.split(',') : [
          "patent_number", 
          "patent_title", 
          "patent_abstract", 
          "patent_date", 
          "patent_type",
          "inventors.inventor_first_name",
          "inventors.inventor_last_name",
          "assignees.assignee_organization",
          "cpc_section_id",
          "cpc_subsection_id",
          "cited_patent_number"
        ],
        o: {
          "per_page": params.maxResults || 10
        }
      };
      
      // Add date filters if provided
      if (params.startDate || params.endDate) {
        const dateFilter: any = {};
        if (params.startDate) dateFilter._gte = params.startDate;
        if (params.endDate) dateFilter._lte = params.endDate;
        requestBody.q._and = [{ patent_date: dateFilter }];
      }

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': env.PATENTSVIEW_API_KEY
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`PatentsView API error: ${response.statusText}`);
      }

      const data = await response.json();
      return handleToolSuccess(data, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Open Library API Tool
export const bookSearch: ToolCard = {
  id: 'book_search',
  name: 'Book Search',
  description: 'Search for books and retrieve detailed information using the Open Library API',
  capabilities: ['book_search', 'bibliographic_data', 'author_information'],
  inputTypes: {
    query: 'Search query for books (title, author, subject, etc.)',
    maxResults: 'Maximum number of results (default: 10)',
    searchType: 'Type of search: q (general), title, author, subject (default: q)'
  },
  outputType: 'List of books with title, author, publication info, and availability data',
  demoCommands: [
    {
      command: 'bookSearch({ query: "Foundation Asimov", searchType: "title" })',
      description: 'Search for books with "Foundation" in the title by Asimov'
    }
  ],
  metadata: {
    limitations: [
      'No API key required but rate limited to prevent abuse',
      'Some book details may be incomplete',
      'Cover images may not be available for all books'
    ],
    bestPractices: [
      'Include author names for more specific results',
      'Use ISBN for exact book matching when available',
      'Specify search type for more targeted results'
    ]
  },
  compatibilityMetadata: {
    queryTypes: {
      'book': 0.9,
      'literature': 0.9,
      'educational': 0.8,
      'general_knowledge': 0.7
    },
    patterns: [
      'book', 'author', 'novel', 'publication', 'read',
      'literature', 'textbook', 'isbn', 'title', 'biography'
    ],
    urlCompatible: false,
    entityTypes: ['book', 'author', 'publisher', 'genre', 'subject']
  },
  relevanceScore(query: string, analysis: QueryAnalysis): number {
    return calculateRelevanceScore(
      this.compatibilityMetadata.patterns,
      this.compatibilityMetadata.queryTypes,
      this.compatibilityMetadata.entityTypes,
      query,
      analysis
    );
  },
  async execute(params: ToolParams, env: Env): Promise<ToolResult> {
    try {
      if (!params.query) {
        throw new Error('Query parameter is required');
      }

      const startTime = Date.now();
      let url: URL;
      
      // Check if query is an ISBN number
      const isbnRegex = /^(?:\d{10}|\d{13})$/;
      if (isbnRegex.test(params.query.replace(/-/g, ''))) {
        // ISBN search
        const formattedIsbn = params.query.replace(/-/g, '');
        url = new URL(`https://openlibrary.org/api/books`);
        url.searchParams.append('bibkeys', `ISBN:${formattedIsbn}`);
        url.searchParams.append('format', 'json');
        url.searchParams.append('jscmd', 'data');
      } else {
        // General search
        url = new URL('https://openlibrary.org/search.json');
        
        // Handle different search types
        const searchType = params.searchType || 'q';
        if (searchType === 'q') {
          url.searchParams.append('q', params.query);
        } else if (['title', 'author', 'subject'].includes(searchType)) {
          url.searchParams.append(searchType, params.query);
        } else {
          url.searchParams.append('q', params.query);
        }
        
        url.searchParams.append('limit', (params.maxResults || 10).toString());
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Process and format results
      let results: any[];
      if (isbnRegex.test(params.query.replace(/-/g, ''))) {
        // Format ISBN results
        results = Object.entries(data as Record<string, any>).map(([_, book]) => ({
          title: book.title,
          authors: book.authors?.map((author: any) => author.name) || [],
          publishDate: book.publish_date,
          publisher: book.publishers?.[0] || '',
          isbn: book.identifiers?.isbn_13?.[0] || book.identifiers?.isbn_10?.[0] || '',
          numberOfPages: book.number_of_pages,
          cover: book.cover,
          url: book.url
        }));
      } else {
        // Format search results
        const searchData = data as { docs?: any[], numFound?: number };
        results = searchData.docs?.slice(0, params.maxResults || 10).map((book) => ({
          title: book.title,
          authors: book.author_name || [],
          publishYear: book.first_publish_year,
          publishers: book.publisher,
          isbn: book.isbn?.[0] || '',
          language: book.language,
          subjects: book.subject?.slice(0, 5) || [],
          coverId: book.cover_i,
          key: book.key
        })) || [];
      }

      return handleToolSuccess({
        query: params.query,
        results: results,
        numFound: (data as any).numFound || results.length
      }, startTime, 0.9);
    } catch (error: unknown) {
      return handleToolError(error);
    }
  }
};

// Export all tools
export const tools = {
  braveSearch,
  tavilySearch,
  githubRepoSearch,
  githubCodeSearch,
  fireCrawl,
  youtubeTranscript,
  arXivSearch,
  newsApiSearch,
  stackExchangeSearch,
  wikipediaSearch,
  patentSearch,
  bookSearch
} as const;
