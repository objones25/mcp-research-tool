import { WorkerEntrypoint } from 'cloudflare:workers';
import { ProxyToSelf } from 'workers-mcp';
import { Env } from './types';
import { orchestrator } from './orchestrator';
import { formatter } from './formatter';

export default class ResearchWorker extends WorkerEntrypoint<Env> {
  /**
   * @description Performs research based on a query using multiple tools to gather and synthesize information
   * @param {string} query - The search query to execute
   * @param {number} [depth=5] - Research depth level (must be between 1 and 5)
   * @returns {{ content: Array<{ type: "text", text: string }> }} Formatted research results
   * @example
   * await research("What are the latest developments in quantum computing?", 3)
   */
  async research(
    query: string,
    depth: number = 5
  ) {
    try {
      const result = await orchestrator.orchestrateResearch(query, depth, this.env);
      const formattedText = formatter.formatResearchResult(result, {
        includeMetadata: true,
        maxSources: 10
      });

      return {
        content: [{
          type: "text",
          text: formattedText
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        content: [{
          type: "text",
          text: `# Error Processing Research Query 🔴\n\n${errorMessage}`
        }]
      };
    }
  }

  // Main fetch handler using ProxyToSelf pattern
  async fetch(request: Request): Promise<Response> {
    return new ProxyToSelf(this).fetch(request);
  }
}
