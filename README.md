# Research Orchestration Service

A powerful, AI-driven research orchestration service that gathers, analyzes, and synthesizes information from multiple sources to provide comprehensive answers to complex queries. Built on Cloudflare Workers, this service leverages multiple specialized tools and AI capabilities to deliver well-structured, properly cited research results.

## Overview

This service transforms natural language queries into structured research tasks, intelligently selecting and orchestrating various specialized tools to gather relevant information. It then synthesizes the collected data into a coherent, well-cited response with confidence indicators.

## Key Features

- **Intelligent Query Analysis**: 
  - Advanced analysis of user queries to understand intent, entities, and constraints
  - Query optimization for each specialized research tool
  - Automatic URL and context extraction

- **Multi-tool Orchestration**: 
  - Dynamic tool selection based on query context and relevance scoring
  - Parallel execution with smart retry logic
  - Automatic query adaptation for each tool
  - Intelligent tool reuse across research iterations

- **Iterative Research Process**: 
  - Multiple research iterations with targeted gap analysis
  - Highly focused follow-up queries for missing information
  - Effective handling of follow-up iterations
  - Smart termination when sufficient information is gathered

- **AI-powered Synthesis**: 
  - Combines information from diverse sources into comprehensive answers
  - Proper citation and source attribution
  - Structured formatting with sections and highlights

- **Quality Assurance**:
  - Confidence scoring for individual results and overall synthesis
  - Source credibility assessment
  - Relevance filtering of results
  - Batch processing for efficient analysis

- **Performance Optimization**:
  - Built-in caching system using Cloudflare KV
  - Parallel execution of tools
  - Smart retry logic for API failures
  - Efficient batching for result assessment

## Architecture

### Core Components

1. **Orchestrator** (`src/orchestrator.ts`):
   - Coordinates the entire research process
   - Manages tool selection and execution with intelligent reuse
   - Handles result aggregation and synthesis
   - Supports metadata-enriched tool execution for better context

2. **Query Optimizer** (`src/queryOptimizer.ts`):
   - Analyzes queries for intent and context
   - Optimizes queries for different tools
   - Extracts entities, URLs, and YouTube video IDs

3. **Tool Manager** (`src/toolManager.ts`):
   - Handles tool selection based on relevance
   - Manages tool execution with retry logic and caching
   - Provides unified error handling
   - Uses a fallback to score-based selection when needed

4. **Result Processor** (`src/resultProcessor.ts`):
   - Assesses result relevance with batch processing
   - Analyzes information gaps and creates targeted follow-up queries
   - Synthesizes final results
   - Implements parallel processing for better performance

5. **Formatter** (`src/formatter.ts`):
   - Structures output with proper formatting
   - Handles citation management
   - Provides confidence indicators

### Research Process

The research process follows these steps:

1. **Query Analysis**: The query is analyzed to understand intent, extract entities, identify URLs, and determine query types.

2. **Tool Selection**: 
   - Tools are selected based on relevance to the query
   - On initial iterations, previously used tools are filtered out
   - For follow-up queries, tools can be reused to explore new aspects

3. **Query Optimization**: The query is optimized for each selected tool to maximize relevance.

4. **Tool Execution**: 
   - Tools are executed in parallel with metadata context
   - Automatic extraction of URLs and YouTube video IDs when relevant
   - Results are cached for performance

5. **Relevance Assessment**:
   - Results are assessed for relevance against the original query
   - Processing occurs in batches to handle large result sets efficiently
   - Diversity is ensured through batch processing

6. **Gap Analysis**:
   - Information gaps are identified
   - Targeted follow-up queries focus on missing aspects
   - Analysis provides specific missing aspects and explains the gaps

7. **Iteration**: 
   - Process repeats with follow-up queries until gaps are filled
   - Tools can be reused between iterations for different aspects
   - Each iteration builds on previous knowledge

8. **Synthesis**: 
   - All relevant results are synthesized into a comprehensive answer
   - Sources are properly cited and organized
   - Confidence score is calculated based on source quality and content

### Research Tools

The service integrates with multiple specialized research tools:

1. **Web Search**:
   - **Brave Search**: Privacy-focused web search with broad coverage
   - **Tavily Search**: AI-powered search with enhanced relevance

2. **Technical Information**:
   - **GitHub Repository Search**: Find relevant repositories
   - **GitHub Code Search**: Search for code examples and implementations
   - **Stack Exchange**: Technical Q&A from Stack Overflow and related sites

3. **Academic Research**:
   - **arXiv**: Academic papers and preprints
   - **Patent Search**: Intellectual property and innovation tracking

4. **Current Events**:
   - **News API**: Recent news and developments
   - **Media Monitoring**: Current events tracking

5. **Content Extraction**:
   - **Fire Crawl**: Web content extraction and analysis
   - **YouTube Transcript**: Video content transcription

6. **Reference Information**:
   - **Wikipedia Search**: General knowledge and reference
   - **Book Search**: Literature and bibliographic information

## Usage

### Basic Example

```typescript
const worker = new ResearchWorker();

const result = await worker.research(
  "What are the latest developments in quantum computing?",
  3  // Research depth (1-5)
);

console.log(result.content[0].text);
```

### Response Format

```typescript
interface ResearchResult {
  answer: string;          // Synthesized research answer
  sources: Source[];       // List of sources used
  confidence: number;      // Overall confidence score (0-1)
  metadata: {
    executionTime: number;
    iterations: number;
    totalResults: number;
    queryTypes: string[];
    toolsUsed: string[];
    toolResults: ToolResult[];
  }
}
```

## Setup and Configuration

### Prerequisites

- Cloudflare Workers account
- Node.js 16+
- Wrangler CLI

### Required API Keys

```env
# Core APIs
BRAVE_API_KEY=your_brave_api_key
TAVILY_API_KEY=your_tavily_api_key
GITHUB_TOKEN=your_github_token
FIRE_CRAWL_API_KEY=your_fire_crawl_api_key
NEWS_API_KEY=your_news_api_key
PATENTSVIEW_API_KEY=your_patentsview_api_key

# LLM APIs
OPENAI_API_KEY=your_openai_api_key
GROQ_API_KEY=your_groq_api_key

# Cloudflare Resources
SHARED_SECRET=your_shared_secret     # For API authentication
RESEARCH_CACHE=your_kv_namespace     # For result caching
```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/research-orchestration-service.git
   cd research-orchestration-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. Deploy to Cloudflare Workers:
   ```bash
   wrangler publish
   ```

## Configuration Options

### Research Depth

The `depth` parameter (1-5) controls:
- Number of research iterations
- Number of tools used (depth * 1.5)
- Result synthesis complexity

### Tool Selection

Tool selection is managed through:
- Relevance scoring in `src/tools.ts`
- Tool compatibility metadata for query types
- Intelligent reuse between iterations
- Context-aware query optimization

### Batch Processing

The system uses batch processing for:
- Relevance assessment (batch size: 5, parallel batches: 3)
- Gap analysis (batch size: 8)
- Final diversity pass for large result sets

### Caching

The system implements caching at multiple levels:
- Full research results (TTL: 3 days)
- Individual tool executions
- Contextual metadata to improve cache hits

## Advanced Features

### Targeted Follow-up Queries

The system generates highly targeted follow-up queries that:
- Focus specifically on missing information
- Use precise terms related to identified gaps
- Avoid repeating already gathered information
- Include explanations of the missing aspects

### Intelligent Tool Reuse

Unlike traditional systems that avoid tool repetition:
- Initial queries filter out previously used tools
- Follow-up queries can reuse tools for new aspects
- Prevents repeating the exact same tool set consecutively
- Ensures comprehensive coverage of topics

### Metadata-Enriched Execution

Tool execution includes rich context:
- Iteration number
- Original and current queries
- Follow-up query indicators
- Extracted URLs and media IDs

## Error Handling

The service implements comprehensive error handling:
- Automatic retries for transient failures
- Fallback strategies for tool failures
- Detailed error reporting
- Request validation

## Future Improvements

- [ ] Add support for more specialized research tools
- [ ] Implement advanced caching strategies
- [ ] Enhance query understanding with better NLP
- [ ] Add support for domain-specific research workflows
- [ ] Improve source verification and fact-checking
- [ ] Add support for real-time updates and streaming results
- [ ] Implement rate limiting and quota management
- [ ] Add support for custom tool configurations

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

This project leverages multiple APIs and services:
- Brave Search API for web search
- Tavily AI for enhanced search
- GitHub API for code search
- arXiv API for academic research
- News API for current events
- Open Library API for book information
- PatentsView API for patent information
- Cloudflare Workers for hosting and execution
- OpenAI and Groq APIs for AI processing

Special thanks to:
- The Octotools team for inspiring the orchestration component architecture
- All the API providers and the open-source community for making this project possible. 