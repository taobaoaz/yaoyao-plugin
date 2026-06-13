/**
 * utils/memory-store-types.ts — YaoyaoMemoryConfig and MemoryEntry types.
 */

export interface YaoyaoMemoryConfig {
  capture?: {
    enabled?: boolean;
    mode?: "sync" | "async";
    maxContentLen?: number;
    minContentLen?: number;
    batchSize?: number;
    debounceMs?: number;
    excludeAgents?: string[];
  };
  recall?: {
    enabled?: boolean;
    strategy?: "hybrid" | "fts" | "vector";
    maxResults?: number;
    topK?: number;
    minScore?: number;
    cacheTTL?: number;
    maxCacheSize?: number;
    halfLife?: number;
    jaccardBase?: number;
    jaccardMin?: number;
    maxSessions?: number;
    maxContextKeywords?: number;
    decayMode?: string;
    position?: string;
    timeoutMs?: number;
    excludeRecentMS?: number;
    minResults?: number;
    maxChars?: number;
    scoreThreshold?: number;
    hintText?: string;
    enableMmr?: boolean;
    mmrLambda?: number;
  };
  memoryDir?: string;
  embedding?: {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    dimensions?: number;
    vectorBackend?: string;
    hnswMaxElements?: number;
    provider?: string;
    providerModels?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    maxInputChars?: number;
    backoffBaseMs?: number;
    authType?: string;
    customHeaders?: Record<string, string>;
  };
  llm?: {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  cleanup?: {
    enabled?: boolean;
    l0l1RetentionDays?: number;
    allowAggressiveCleanup?: boolean;
  };
  compaction?: {
    enabled?: boolean;
    minAgeDays?: number;
    similarityThreshold?: number;
    minClusterSize?: number;
    maxEntriesToScan?: number;
    dryRun?: boolean;
  };
  sessionRecovery?: {
    maxMemories?: number;
    maxAgeMs?: number;
  };
  hooks?: {
    commandNew?: {
      enabled?: boolean;
    };
    heartbeat?: {
      enabled?: boolean;
      maxResults?: number;
      minScore?: number;
      maxContextChars?: number;
    };
  };
  snippetMaxLen?: number;
  searchMaxLimit?: number;
  likeFallbackScore?: number;
  tz?: string;
  blockLabels?: string[];
  [key: string]: unknown;
}

export interface MemoryEntry {
  type: "daily" | "memory" | "archive";
  path: string;
  filename: string;
  date?: string;
  size: number;
  modified: number;
  importance?: number;
}
