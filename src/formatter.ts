import { ResearchResult } from './types';

/**
 * Options for formatting research results
 */
interface FormatterOptions {
  /** Whether to include metadata in the output */
  includeMetadata?: boolean;
  /** Maximum number of sources to show */
  maxSources?: number;
}

/**
 * Formats a research result into a markdown string
 * @param result - The research result to format
 * @param options - Formatting options
 * @returns A markdown formatted string containing the research results
 */
function formatResearchResult(
  result: ResearchResult,
  options: FormatterOptions = {}
): string {
  const {
    includeMetadata = false,
    maxSources = 5
  } = options;

  // Build markdown content sections
  const sections = [
    formatHeader(result),
    result.answer,
    formatSources(result.sources, maxSources),
    includeMetadata ? formatMetadata(result.metadata) : ''
  ].filter(Boolean);

  return sections.join('\n\n');
}

// Format the header with confidence indicator
function formatHeader(result: ResearchResult): string {
  const confidenceEmoji = result.confidence >= 0.8 ? '🟢' : 
                         result.confidence >= 0.5 ? '🟡' : '🔴';
  
  const confidenceText = result.confidence >= 0.8 ? 'High confidence' : 
                         result.confidence >= 0.5 ? 'Moderate confidence' : 'Low confidence';
  
  return `# Research Results ${confidenceEmoji}\n*${confidenceText}*`;
}

// Format sources list
function formatSources(sources: string[], maxSources: number): string {
  if (sources.length === 0) return '';
  
  const sourcesList = sources
    .slice(0, maxSources)
    .map(source => `- ${formatSource(source)}`)
    .join('\n');
  
  const hasMore = sources.length > maxSources;
  const moreInfo = hasMore ? `\n*...and ${sources.length - maxSources} more sources*` : '';
  
  return `## Sources\n${sourcesList}${moreInfo}`;
}

// Format a single source, handling URLs properly
function formatSource(source: string): string {
  // Extract URL if present
  const urlMatch = source.match(/(https?:\/\/[^\s]+)/);
  if (!urlMatch) return source;
  
  const url = urlMatch[1];
  const label = source.replace(url, '').trim() || url;
  
  return `[${label}](${url})`;
}

// Format metadata section
function formatMetadata(metadata: ResearchResult['metadata']): string {
  if (!metadata) return '';
  
  const items = [
    `**Time**: ${metadata.executionTime}ms`,
    `**Tools**: ${metadata.toolsUsed.join(', ')}`,
    `**Query Types**: ${metadata.queryTypes.join(', ')}`
  ];
  
  return `## Metadata\n${items.join('\n')}`;
}

export const formatter = {
  formatResearchResult
};
