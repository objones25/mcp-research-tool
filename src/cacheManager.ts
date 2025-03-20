import { Env, ToolResult } from './types';

/**
 * Default cache expiration time (24 hours)
 */
const DEFAULT_CACHE_TTL = 86400;

/**
 * Generate a cache key from tool ID and parameters
 */
export function generateCacheKey(toolId: string, params: Record<string, any>): string {
  // Sort params to ensure consistent keys regardless of parameter order
  const sortedParams = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  
  // Create a string representation of parameters
  const paramsStr = sortedParams
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
    .join(',');
  
  return `${toolId}:${paramsStr}`;
}

/**
 * Get cached result for a tool execution
 */
export async function getCachedResult(
  toolId: string,
  params: Record<string, any>,
  env: Env
): Promise<ToolResult | null> {
  if (!env.RESEARCH_CACHE) return null;
  
  try {
    const cacheKey = generateCacheKey(toolId, params);
    const cachedData = await env.RESEARCH_CACHE.get(cacheKey, 'json') as ToolResult | null;
    
    if (cachedData) {
      return {
        success: cachedData.success,
        data: cachedData.data,
        error: cachedData.error,
        metadata: {
          ...(cachedData.metadata || {}),
          fromCache: true
        }
      };
    }
    
    return null;
  } catch (error) {
    console.error('Cache retrieval error:', error);
    return null;
  }
}

/**
 * Cache result from a tool execution
 */
export async function cacheResult(
  toolId: string,
  params: Record<string, any>,
  result: ToolResult,
  env: Env,
  ttl: number = DEFAULT_CACHE_TTL
): Promise<void> {
  if (!env.RESEARCH_CACHE || !result.success) return;
  
  try {
    const cacheKey = generateCacheKey(toolId, params);
    await env.RESEARCH_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
  } catch (error) {
    console.error('Cache storage error:', error);
  }
}

/**
 * Execute a tool with caching
 */
export async function executeWithCache(
  toolId: string,
  execute: () => Promise<ToolResult>,
  params: Record<string, any>,
  env: Env,
  ttl: number = DEFAULT_CACHE_TTL
): Promise<ToolResult> {
  // Try to get from cache first
  const cachedResult = await getCachedResult(toolId, params, env);
  if (cachedResult) return cachedResult;
  
  // Execute the tool
  const result = await execute();
  
  // Cache successful results
  if (result.success) {
    await cacheResult(toolId, params, result, env, ttl);
  }
  
  return result;
}

export const cacheManager = {
  generateCacheKey,
  getCachedResult,
  cacheResult,
  executeWithCache
}; 