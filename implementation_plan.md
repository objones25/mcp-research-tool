# Updated Minimalist Research MCP Server Implementation Plan

## Overall Architecture

The minimalist research MCP server will be built on Cloudflare Workers using workers-mcp and Hono, with orchestration inspired by octotools and query enhancement inspired by DSPy. This architecture combines Hono's elegant routing with workers-mcp compatibility for AI assistant integration.

## Directory Structure

```
.
├── dist                    # Build output directory
├── package.json            # Project dependencies and scripts
├── src
│   ├── index.ts            # Main entry point combining Hono and workers-mcp
│   ├── tools.ts            # Tool card implementations for research tools
│   ├── orchestrator.ts     # Tool selection and execution orchestrator
│   ├── queryEnhancer.ts    # Query analysis and enhancement
│   ├── formatter.ts        # Result formatting utilities
│   ├── types.ts            # Type definitions for all components
│   └── utils.ts            # Utility functions (error, logging, caching)
├── test                    # Test directory
└── wrangler.jsonc          # Cloudflare Worker configuration
```

## Core Components and Responsibilities

### 1. `index.ts`: Main Entry Point

- Combines Hono for RESTful API endpoints with workers-mcp for AI assistant integration
- Defines environment interface for API keys
- Exposes research tools as MCP methods
- Implements the fetch handler using ProxyToSelf pattern

### 2. `tools.ts`: Tool Cards

Each tool in `tools.ts` will follow the OctoTools-inspired tool card pattern:

```typescript
const toolCard = {
  id: "tool_id",
  name: "Human-Readable Tool Name",
  description: "Detailed description of what the tool does",
  capabilities: ["capability1", "capability2"],
  inputTypes: {
    param1: "Description of parameter 1",
    param2: "Description of parameter 2"
  },
  outputType: "Description of the output format",
  demoCommands: [
    {
      command: 'Example of how to call this tool',
      description: 'What this command accomplishes'
    }
  ],
  metadata: {
    limitations: ["Limitation 1", "Limitation 2"],
    bestPractices: ["Practice 1", "Practice 2"]
  },
  
  // Relevance scoring function
  relevanceScore: (query: string, analysis: QueryAnalysis) => {
    // Base score calculation using multiple factors
    let score = 0;
    
    // 1. Pattern matching for relevant terms (keyword matching)
    const patternScore = calculatePatternScore(query);
    
    // 2. Query type compatibility
    const typeScore = calculateTypeScore(analysis.queryTypes);
    
    // 3. URL presence compatibility
    const urlScore = calculateUrlScore(analysis.extractedUrls);
    
    // 4. Entity match compatibility
    const entityScore = calculateEntityScore(analysis.entities);
    
    // Weight and combine the factors
    score = (patternScore * 0.4) + (typeScore * 0.3) + (urlScore * 0.2) + (entityScore * 0.1);
    
    return Math.min(score, 1.0); // Cap at 1.0
  },
  
  // Compatibility metadata (helps explain the relevance logic)
  compatibilityMetadata: {
    queryTypes: {
      'general_knowledge': 0.7,
      'current_events': 0.6,
      // etc.
    },
    patterns: [
      'search', 'find', 'look up', 'what is', 'how to'
    ],
    urlCompatible: true|false,
    entityTypes: [
      'person', 'organization', 'location', 'technology'
    ]
  },
  
  // Execute method containing the API call implementation
  execute: async (params, env) => { /* implementation */ }
}
```

Tools to implement:
- Brave Search Tool
- Tavily Search Tool
- GitHub Repository Search Tool
- GitHub Code Search Tool
- Fire Crawl Tool
- YouTube Transcript Tool

Each tool will contain its specific API call implementation within the `execute` method, encapsulating all external API interactions within the tool definition.

### 3. `orchestrator.ts`: Orchestration Layer

The orchestrator will be the heart of our system, directly inspired by OctoTools' planner-executor architecture:

1. **Query Analysis Phase**:
   - Use the queryEnhancer to understand query intent and extract entities
   - Determine which tools might be relevant for the query

2. **Tool Selection Phase**:
   - Use an LLM to select the most appropriate tools for the query
   - Prioritize tools based on their relevance to the query and confidence score
   - Generate a plan for which tools to execute

3. **Execution Phase**:
   - Execute selected tools in parallel with appropriate parameters
   - Manage timeouts and failures gracefully
   - Collect results from all tools

4. **Synthesis Phase**:
   - Combine results from multiple tools
   - Format results in a human-readable way
   - Return a comprehensive response that addresses the original query

The orchestrator will include these key functions:

```typescript
// Calculate relevance scores for all tools
async function calculateToolRelevanceScores(query: string, analysis: QueryAnalysis): Promise<Array<{tool: Tool, score: number}>> {
  return Object.values(tools).map(tool => ({
    tool,
    score: tool.relevanceScore(query, analysis)
  }));
}

// Automatic tool selection based on relevance scores
async function selectTools(query: string, analysis: QueryAnalysis, maxTools: number = 3): Promise<Tool[]> {
  const scoredTools = await calculateToolRelevanceScores(query, analysis);
  
  // Sort by relevance score (descending)
  scoredTools.sort((a, b) => b.score - a.score);
  
  // Select the top N tools
  return scoredTools.slice(0, maxTools).map(item => item.tool);
}

// LLM-enhanced tool selection
async function selectToolsWithLLM(query: string, analysis: QueryAnalysis, maxTools: number = 3): Promise<{tools: Tool[], reasoning: string[]}> {
  // Calculate relevance scores
  const scoredTools = await calculateToolRelevanceScores(query, analysis);
  
  // Create context for LLM
  const toolsContext = scoredTools.map(({ tool, score }) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    capabilities: tool.capabilities,
    relevanceScore: score
  }));
  
  // Prompt the LLM for tool selection
  const response = await getLLMToolSelection(query, analysis, toolsContext, maxTools);
  
  // Parse and validate the selected tools
  const selectedTools = response.selectedTools
    .map(id => tools[id])
    .filter(Boolean);
  
  return {
    tools: selectedTools,
    reasoning: response.reasoning
  };
}

// Main orchestration function
async function orchestrateResearch(query: string, depth: number = 3, env: Env): Promise<ResearchResult> {
  // 1. Analyze the query
  const analysis = queryEnhancer.analyzeQuery(query);
  
  // 2. Select tools
  const { tools: selectedTools, reasoning } = await selectToolsWithLLM(query, analysis, Math.ceil(depth * 1.5));
  
  // 3. Execute tools in parallel
  const results = await Promise.all(
    selectedTools.map(tool => executeToolWithRetry(tool, query, analysis, env))
  );
  
  // 4. Synthesize results
  const answer = synthesizeResults(query, selectedTools, results);
  
  // 5. Return formatted result
  return {
    answer,
    sources: extractSources(results, selectedTools),
    confidence: calculateOverallConfidence(results, analysis),
    metadata: {
      executionTime: Date.now() - startTime,
      toolsUsed: selectedTools.map(t => t.id),
      queryTypes: analysis.queryTypes,
      toolSelectionReasoning: reasoning
    }
  };
}
```

### 4. `queryEnhancer.ts`: Query Analysis

This component will extract valuable information from the query to guide tool selection:

- Intent detection using regex patterns 
- Entity extraction (people, organizations, etc.)
- Query type classification (technical, current events, general knowledge)
- URL detection and extraction
- YouTube link detection
- Confidence calculation for the analysis

Key functions:

```typescript
// Main function to analyze query
function analyzeQuery(query: string): QueryAnalysis {
  // Extract URLs
  const extractedUrls = extractUrls(query);
  const extractedYouTubeUrls = extractYouTubeUrls(query);
  
  // Identify query types
  const queryTypes = identifyQueryTypes(query);
  
  // Extract entities
  const entities = extractEntities(query);
  
  // Determine intent
  const intent = determineIntent(query);
  
  // Extract constraints
  const constraints = extractConstraints(query);
  
  // Calculate confidence
  const confidence = calculateQueryConfidence(query, queryTypes, entities);
  
  return {
    originalQuery: query,
    intent,
    entities,
    constraints,
    queryTypes,
    extractedUrls,
    extractedYouTubeUrls,
    confidence
  };
}
```

### 5. `formatter.ts`: Result Formatting

This utility will ensure consistent, human-readable output format:

- Tool-specific formatters for each type of research tool
- MCP-compatible response structure
- Source attribution in the output
- Error message formatting
- Consistent output structure with headers and sections

### 6. `types.ts`: Type Definitions

Clear TypeScript interfaces for all components:

```typescript
// Environment interface
export interface Env {
  BRAVE_API_KEY: string;
  TAVILY_API_KEY: string;
  GITHUB_TOKEN: string;
  FIREBASE_CRAWL_API_KEY: string;
  YOUTUBE_API_KEY: string;
  // Optional caching
  RESEARCH_CACHE?: KVNamespace;
}

// Tool card interface
export interface ToolCard {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  inputTypes: Record<string, string>;
  outputType: string;
  demoCommands: Array<{command: string, description: string}>;
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

// Tool parameters
export interface ToolParams {
  query?: string;
  url?: string;
  videoId?: string;
  maxResults?: number;
  [key: string]: any;
}

// Tool execution result
export interface ToolResult {
  success: boolean;
  data: any;
  error?: string;
  metadata?: {
    confidence: number;
    executionTime: number;
    [key: string]: any;
  };
}

// Query analysis result
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

// Research result
export interface ResearchResult {
  answer: string;
  sources: string[];
  confidence: number;
  metadata: {
    executionTime: number;
    toolsUsed: string[];
    queryTypes: string[];
    toolSelectionReasoning: string[];
    [key: string]: any;
  };
}
```

### 7. `utils.ts`: Utilities

Minimalist utility functions for common operations:

- Error handling with consistent patterns
- Optional caching with KV storage
- Simple logging helpers
- Retry mechanisms for API calls

## Tool-Specific Relevance Scoring

Each tool will have a custom relevance scoring implementation tailored to its capabilities:

### 1. Brave Search Tool

```typescript
relevanceScore: (query: string, analysis: QueryAnalysis) => {
  // Pattern matching for search-related terms
  const patternScore = calculatePatternScore(query, [
    'search', 'find', 'look up', 'what is', 'information',
    'how to', 'where', 'when', 'who', 'why'
  ]);
  
  // Query type compatibility
  const typeScores = {
    'general_knowledge': 0.8,
    'current_events': 0.8,
    'comparison': 0.6,
    'technical': 0.5
  };
  const typeScore = Math.max(...analysis.queryTypes.map(type => typeScores[type] || 0.3));
  
  // URL compatibility (less relevant if query already has URLs)
  const urlScore = analysis.extractedUrls.length > 0 ? 0.2 : 0.7;
  
  // Entity compatibility (good for entities)
  const entityScore = analysis.entities.length > 0 ? 0.7 : 0.4;
  
  // Weighted combination
  return Math.min(
    (patternScore * 0.4) + (typeScore * 0.3) + (urlScore * 0.2) + (entityScore * 0.1), 
    1.0
  );
}
```

### 2. GitHub Repository Search Tool

```typescript
relevanceScore: (query: string, analysis: QueryAnalysis) => {
  // Pattern matching for technical/code-related terms
  const patternScore = calculatePatternScore(query, [
    'github', 'repository', 'repo', 'code', 'package',
    'library', 'framework', 'project', 'programming',
    'developer', 'open source', 'source code'
  ]);
  
  // Query type compatibility
  const typeScores = {
    'technical': 0.9,
    'comparison': 0.7,
    'general_knowledge': 0.3,
    'current_events': 0.2
  };
  const typeScore = Math.max(...analysis.queryTypes.map(type => typeScores[type] || 0.2));
  
  // URL compatibility
  const urlScore = 0.3; // GitHub search is not URL-focused
  
  // Entity compatibility
  const entityScore = analysis.entities.some(entity => 
    /github|library|framework|programming language/i.test(entity)
  ) ? 0.8 : 0.3;
  
  // Weighted combination
  return Math.min(
    (patternScore * 0.5) + (typeScore * 0.3) + (urlScore * 0.1) + (entityScore * 0.1), 
    1.0
  );
}
```

### 3. Fire Crawl Tool

```typescript
relevanceScore: (query: string, analysis: QueryAnalysis) => {
  // Pattern matching for content extraction terms
  const patternScore = calculatePatternScore(query, [
    'webpage', 'website', 'content', 'extract', 'scrape',
    'article', 'blog', 'page', 'site'
  ]);
  
  // Query type compatibility
  const typeScores = {
    'technical': 0.6,
    'current_events': 0.7,
    'general_knowledge': 0.6,
    'comparison': 0.4
  };
  const typeScore = Math.max(...analysis.queryTypes.map(type => typeScores[type] || 0.3));
  
  // URL compatibility (highly relevant if query has URLs)
  const urlScore = analysis.extractedUrls.length > 0 ? 1.0 : 0.1;
  
  // Entity compatibility
  const entityScore = 0.4; // Moderate relevance for entities
  
  // Weighted combination with high emphasis on URL presence
  return Math.min(
    (patternScore * 0.2) + (typeScore * 0.1) + (urlScore * 0.6) + (entityScore * 0.1), 
    1.0
  );
}
```

### 4. YouTube Transcript Tool

```typescript
relevanceScore: (query: string, analysis: QueryAnalysis) => {
  // Pattern matching for video/transcript-related terms
  const patternScore = calculatePatternScore(query, [
    'youtube', 'video', 'transcript', 'caption', 'speech',
    'lecture', 'talk', 'presentation', 'watch'
  ]);
  
  // Query type compatibility
  const typeScores = {
    'technical': 0.6,
    'current_events': 0.7,
    'general_knowledge': 0.6,
    'comparison': 0.3
  };
  const typeScore = Math.max(...analysis.queryTypes.map(type => typeScores[type] || 0.3));
  
  // YouTube URL compatibility (highly relevant if query has YouTube URLs)
  const urlScore = analysis.extractedYouTubeUrls.length > 0 ? 1.0 : 0.1;
  
  // Entity compatibility
  const entityScore = analysis.entities.some(entity => 
    /youtube|video|channel|creator/i.test(entity)
  ) ? 0.8 : 0.2;
  
  // Weighted combination with high emphasis on YouTube URL presence
  return Math.min(
    (patternScore * 0.2) + (typeScore * 0.1) + (urlScore * 0.6) + (entityScore * 0.1), 
    1.0
  );
}
```

## LLM-Based Tool Selection Approach

For complex queries, we'll use an LLM to enhance the tool selection process:

1. Prepare a prompt with query analysis and tool metadata:

```typescript
const prompt = `
Given the following query and analysis, select the most appropriate tools to answer it.

Query: "${query}"

Query Analysis:
- Intent: ${analysis.intent}
- Query Types: ${analysis.queryTypes.join(', ')}
- Entities: ${analysis.entities.join(', ')}
- URLs Detected: ${analysis.extractedUrls.join(', ') || 'None'}

Available Tools:
${toolsContext.map(tool => `
- ${tool.name} (${tool.id})
  Description: ${tool.description}
  Capabilities: ${tool.capabilities.join(', ')}
  Relevance Score: ${tool.relevanceScore.toFixed(2)}
`).join('')}

Instructions:
1. Select up to ${maxTools} tools that would be most effective for answering this query
2. Provide a brief justification for each selected tool
3. Consider the relevance scores but use your judgment

The response should be in JSON format:
{
  "selectedTools": ["tool_id1", "tool_id2"],
  "reasoning": ["Reason for tool 1", "Reason for tool 2"]
}
`;
```

2. Process the LLM response to get selected tools and reasoning:

```typescript
const response = await fetchLLMResponse(prompt);
const parsed = JSON.parse(response);

return {
  selectedTools: parsed.selectedTools,
  reasoning: parsed.reasoning
};
```

## MCP Format Response Pattern

All responses will follow a consistent pattern to ensure compatibility with MCP:

```javascript
{
  content: [{
    type: "text",
    text: formattedText
  }]
}
```

Where `formattedText` is a human-readable string containing:
1. Header with the original query
2. Summary of results found
3. Detailed results organized by tool
4. Source attributions where relevant

## Best Practices for Minimalism

1. **Single Responsibility**: Each file has a clear, focused purpose
2. **Functional Approach**: Use pure functions where possible
3. **Minimal Dependencies**: Only include necessary external libraries
4. **Clear Interfaces**: Define boundaries between components
5. **Consistent Patterns**: Use similar patterns across all tools
6. **Error Handling**: Implement consistent error handling
7. **Efficient State Management**: Minimize mutable state

## Tool Specifications

### 1. Brave Search Tool
**Purpose**: Provide web search capabilities with privacy focus
**Parameters**:
- `query` (string, required): The search query to execute
- `count` (number, optional): Number of results to return (default: 10)
**Returns**: Formatted search results with titles, URLs, and descriptions

### 2. Tavily Search Tool
**Purpose**: AI-powered search engine with enhanced ranking
**Parameters**:
- `query` (string, required): The search query to execute
- `search_type` (string, optional): Type of search - "search" or "news" (default: "search")
- `max_results` (number, optional): Number of results to return (default: 5)
**Returns**: Formatted search results with enhanced content extraction

### 3. GitHub Repository Search Tool
**Purpose**: Find relevant GitHub repositories
**Parameters**:
- `query` (string, required): The search query for repositories
- `max_results` (number, optional): Number of results to return (default: 5)
**Returns**: Formatted repository information with name, URL, description, language, and stars

### 4. Fire Crawl Web Scraping Tool
**Purpose**: Extract content from specific webpages
**Parameters**:
- `url` (string, required): URL to scrape content from
**Returns**: Formatted content extracted from the webpage

### 5. GitHub Code Search Tool
**Purpose**: Search for specific code snippets across GitHub
**Parameters**:
- `query` (string, required): The search query for code
- `max_results` (number, optional): Number of results to return (default: 5)
- `language` (string, optional): Programming language filter
**Returns**: Formatted code search results with repository, file path, and code snippets

### 6. YouTube Transcript Tool
**Purpose**: Extract transcripts from YouTube videos
**Parameters**:
- `video_url` (string, required): YouTube video URL or ID
- `lang` (string, optional): Language code for transcript (default: "en")
**Returns**: Formatted transcript content from the YouTube video

### 7. Orchestrated Research Tool
**Purpose**: Combine multiple research tools based on query analysis
**Parameters**:
- `query` (string, required): Research question to answer
- `depth` (number, optional): Depth of research from 1-5 (default: 3)
**Returns**: Comprehensive research result with answer, sources, and metadata

By applying these OctoTools-inspired approaches to our minimalist research MCP server, we can create a powerful, extensible system that dynamically adapts to different research needs while maintaining a simple, focused architecture.