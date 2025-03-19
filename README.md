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

- **Iterative Research Process**: 
  - Multiple research iterations with gap analysis
  - Automatic follow-up queries for incomplete information
  - Smart termination when sufficient information is gathered

- **AI-powered Synthesis**: 
  - Combines information from diverse sources into comprehensive answers
  - Proper citation and source attribution
  - Structured formatting with sections and highlights

- **Quality Assurance**:
  - Confidence scoring for individual results and overall synthesis
  - Source credibility assessment
  - Relevance filtering of results

- **Performance Optimization**:
  - Built-in caching system using Cloudflare KV
  - Parallel execution of tools
  - Smart retry logic for API failures

## Architecture

### Core Components

1. **Orchestrator** (`src/orchestrator.ts`):
   - Coordinates the entire research process
   - Manages tool selection and execution
   - Handles result aggregation and synthesis

2. **Query Optimizer** (`src/queryOptimizer.ts`):
   - Analyzes queries for intent and context
   - Optimizes queries for different tools
   - Extracts entities and constraints

3. **Tool Manager** (`src/toolManager.ts`):
   - Handles tool selection based on relevance
   - Manages tool execution with retry logic
   - Provides unified error handling

4. **Result Processor** (`src/resultProcessor.ts`):
   - Assesses result relevance
   - Analyzes information gaps
   - Synthesizes final results

5. **Formatter** (`src/formatter.ts`):
   - Structures output with proper formatting
   - Handles citation management
   - Provides confidence indicators

### Research Tools

The service integrates with multiple specialized research tools:

1. **Web Search**:
   - **Brave Search**: Privacy-focused web search with broad coverage
   - **Tavily Search**: AI-powered search with enhanced relevance

2. **Technical Information**:
   - **GitHub Search**: Repository and code search
   - **Stack Exchange**: Technical Q&A from Stack Overflow and related sites

3. **Academic Research**:
   - **arXiv**: Academic papers and preprints
   - **Research Papers**: Scientific literature search

4. **Current Events**:
   - **News API**: Recent news and developments
   - **Media Monitoring**: Current events tracking

5. **Content Extraction**:
   - **Fire Crawl**: Web content extraction and analysis
   - **YouTube Transcript**: Video content transcription

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

# Optional APIs
OPENAI_API_KEY=your_openai_api_key  # For enhanced synthesis
SHARED_SECRET=your_shared_secret     # For API authentication

# Cloudflare Resources
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
- Maximum results per tool

### Tool Selection

Tool selection can be customized by modifying:
- Relevance scoring in `src/tools.ts`
- Tool compatibility metadata
- Query type mappings

### Result Synthesis

Synthesis behavior can be adjusted through:
- Synthesis prompts in `resultProcessor.ts`
- Confidence calculation parameters
- Citation formatting rules

### Caching

Cache behavior is configurable via:
- TTL settings
- Maximum cache size
- Cache key generation rules

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
- Cloudflare Workers for hosting and execution
- OpenAI API for result synthesis (optional)

Special thanks to:
- The Octotools team for inspiring the orchestration component architecture
- All the API providers and the open-source community for making this project possible. 