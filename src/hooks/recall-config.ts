/**
 * hooks/recall-config.ts — Recall configuration types and extraction.
 *
 * Pure config reading from YaoyaoMemoryConfig. No other dependencies.
 *
 * v1.7.0: Added per-agent overrides, query prefix, and recall filter support.
 */
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";

export interface PerAgentRecallOverride {
  maxResults?: number;
  minScore?: number;
  halfLife?: number;
  decayMode?: "weibull" | "logistic";
  position?: "append" | "prepend";
  maxChars?: number;
  timeoutMs?: number;
  queryPrefix?: string;
  enableRecallFilter?: boolean;
  jaccardBase?: number;
  jaccardMin?: number;
}

export interface RecallThresholds {
  cacheTTL: number;
  maxCacheSize: number;
  halfLife: number;
  jaccardBase: number;
  jaccardMin: number;
  maxSessions: number;
  maxContextKeywords: number;
  maxResults: number;
  decayMode: "weibull" | "logistic";
  /** Recall position: "append" = after system prompt (default), "prepend" = before user message (cache-friendly) */
  position: "append" | "prepend";
  /** Max recall time in ms before skipping injection without blocking */
  timeoutMs: number;
  /** Exclude memories created within this many ms ago (0 = disabled). Prevents circular recall. */
  excludeRecentMS: number;
  /** Minimum results required to inject recall context (0 = always inject) */
  minResults: number;
  /** Max characters of recalled context to inject */
  maxChars: number;
  /** Score threshold for confidence scoring */
  scoreThreshold: number;
  /** Query prefix for memory search — enhances user's raw query */
  queryPrefix: string;
  /** Per-agent recall overrides. Keyed by agentId */
  perAgentOverrides: Record<string, PerAgentRecallOverride>;
  /** Enable secondary model-based recall filtering */
  enableRecallFilter: boolean;
  /** Filter model base URL (OpenAI-compatible) */
  recallFilterBaseUrl: string;
  /** Filter model API key */
  recallFilterApiKey: string;
  /** Filter model name */
  recallFilterModel: string;
  /** Filter request timeout */
  recallFilterTimeoutMs: number;
  /** Filter retries */
  recallFilterRetries: number;
  /** Candidate limit per search for filtering */
  recallFilterCandidateLimit: number;
  /** Max chars per candidate sent to filter */
  recallFilterMaxItemChars: number;
  /** If true, fallback to unfiltered results on filter failure */
  recallFilterFailOpen: boolean;
  /** Max chars for recall context injection */
  maxContextChars: number;
  /** Use intent-driven search strategy */
  enableIntentDriven: boolean;
  /** Enable MMR (Maximal Marginal Relevance) re-ranking */
  enableMmr: boolean;
  /** MMR lambda: 1.0 = pure relevance, 0.5 = balanced, 0.0 = pure diversity */
  mmrLambda: number;
  /** v1.8.1 (FadeMem): Access-frequency decay modulation factor. 0 = disabled (fixed half-life).
   *  0.3 (default) = accessCount=10 doubles effective half-life.
   *  Paper: FadeMem (arXiv:2601.18642) — frequently recalled memories decay slower. */
  fadeMemAccessFactor: number;
  /** v1.8.1 (MemX): Hard rejection threshold. If the top-scoring result after
   *  all scoring/diversity is below this, ALL results are rejected (return empty).
   *  This is stricter than scoreThreshold (which gates confidence scoring).
   *  Set to 0 to disable. Paper: MemX (arXiv:2603.16171) — low-confidence rejection
   *  avoids injecting low-quality memories that could mislead the agent. */
  rejectThreshold: number;
}

export function getRecallConfig(config: YaoyaoMemoryConfig): RecallThresholds {
  const r = (config.recall || {}) as Record<string, unknown>;
  return {
    cacheTTL: (r.cacheTTL as number) ?? 30000,
    maxCacheSize: (r.maxCacheSize as number) ?? 50,
    halfLife: (r.halfLife as number) ?? 30,
    jaccardBase: (r.jaccardBase as number) ?? 0.75,
    jaccardMin: (r.jaccardMin as number) ?? 0.5,
    maxSessions: (r.maxSessions as number) ?? 1000,
    maxContextKeywords: (r.maxContextKeywords as number) ?? 20,
    maxResults: (r.maxResults as number) ?? 3,
    decayMode: (r.decayMode as "weibull" | "logistic") ?? "weibull",
    position: (r.position as "append" | "prepend") ?? "append",
    timeoutMs: (r.timeoutMs as number) ?? 800,
    excludeRecentMS: (r.excludeRecentMS as number) ?? 0,
    minResults: (r.minResults as number) ?? 0,
    maxChars: (r.maxChars as number) ?? 1200,
    scoreThreshold: (r.minScore as number) ?? 0.5,
    queryPrefix: (r.queryPrefix as string) ?? "",
    perAgentOverrides: (r.perAgentOverrides ?? {}) as Record<string, PerAgentRecallOverride>,
    enableRecallFilter: (r.enableRecallFilter as boolean) ?? false,
    recallFilterBaseUrl: (r.recallFilterBaseUrl as string) ?? "",
    recallFilterApiKey: (r.recallFilterApiKey as string) ?? "",
    recallFilterModel: (r.recallFilterModel as string) ?? "",
    recallFilterTimeoutMs: (r.recallFilterTimeoutMs as number) ?? 30000,
    recallFilterRetries: (r.recallFilterRetries as number) ?? 1,
    recallFilterCandidateLimit: (r.recallFilterCandidateLimit as number) ?? 30,
    recallFilterMaxItemChars: (r.recallFilterMaxItemChars as number) ?? 500,
    recallFilterFailOpen: (r.recallFilterFailOpen as boolean) ?? true,
    maxContextChars: (r.maxContextChars as number) ?? 1200,
    enableIntentDriven: (r.enableIntentDriven as boolean) ?? false,
    enableMmr: (r.enableMmr as boolean) ?? false,
    mmrLambda: (r.mmrLambda as number) ?? 0.7,
    fadeMemAccessFactor: (r.fadeMemAccessFactor as number) ?? 0.3,
    rejectThreshold: (r.rejectThreshold as number) ?? 0.15,
  };
}

/**
 * Merge per-agent overrides into base config.
 * Returns a new config object (does not mutate input).
 */
export function applyAgentOverrides(
  base: RecallThresholds,
  agentId: string | undefined,
): RecallThresholds {
  if (!agentId || !base.perAgentOverrides) return base;
  const overrides = base.perAgentOverrides[agentId];
  if (!overrides) return base;

  return {
    ...base,
    maxResults: overrides.maxResults ?? base.maxResults,
    scoreThreshold: overrides.minScore ?? base.scoreThreshold,
    halfLife: overrides.halfLife ?? base.halfLife,
    decayMode: overrides.decayMode ?? base.decayMode,
    position: overrides.position ?? base.position,
    maxChars: overrides.maxChars ?? base.maxChars,
    timeoutMs: overrides.timeoutMs ?? base.timeoutMs,
    queryPrefix: overrides.queryPrefix ?? base.queryPrefix,
    enableRecallFilter: overrides.enableRecallFilter ?? base.enableRecallFilter,
    jaccardBase: overrides.jaccardBase ?? base.jaccardBase,
    jaccardMin: overrides.jaccardMin ?? base.jaccardMin,
  };
}
