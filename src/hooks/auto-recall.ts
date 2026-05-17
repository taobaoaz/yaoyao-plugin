/**
 * auto-recall hook - injects relevant memories into the prompt context.
 *
 * Uses api.on("before_prompt_build", ...) to search memory via FTS5
 * and optionally sqlite-vec for semantic similarity search.
 *
 * Enhancements:
 * 1. Time decay scoring (configurable half-life)
 * 2. Diversity sampling (configurable Jaccard threshold)
 * 3. Session context accumulation (configurable max keywords)
 *
 * v1.5.0+: Removed L4 feedback tracking and persona state injection.
 *          Feedback learning moved to yaoyao-soul.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import type { EmbeddingService } from "../utils/embedding.ts";
import { detectSentiment } from "../utils/sentiment.ts";
import { RetrievalStatsCollector, globalRetrievalStats } from "../utils/retrieval-stats.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { expandQuery } from "../utils/query-expander.ts";
import { computeReflectionLogistic, computePresetReflectionScore } from "../utils/reflection-ranking.ts";
import { parseAccessMetadata, buildUpdatedMetadata, computeEffectiveHalfLife } from "../utils/access-tracker.ts";
import { analyzeIntent, applyCategoryBoost } from "../utils/intent-analyzer.ts";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.ts";
import { parseSupportInfo, type SupportInfoV2 } from "../utils/support-info.ts";

import { SimpleLRU } from "../utils/simple-lru.ts";
import { isTrivial } from "../utils/trivial-detector.ts";
import type { AuditLog } from "../utils/audit-log.ts";

// ── Configurable thresholds (read from plugin config) ──
interface RecallThresholds {
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
}

function getRecallConfig(config: YaoyaoMemoryConfig): RecallThresholds {
  const r = config.recall || {};
  return {
    cacheTTL: r.cacheTTL ?? 30000,
    maxCacheSize: r.maxCacheSize ?? 50,
    halfLife: r.halfLife ?? 30,
    jaccardBase: r.jaccardBase ?? 0.75,
    jaccardMin: r.jaccardMin ?? 0.5,
    maxSessions: r.maxSessions ?? 1000,
    maxContextKeywords: r.maxContextKeywords ?? 20,
    maxResults: r.maxResults ?? 3,
    decayMode: (r.decayMode as "weibull" | "logistic") ?? "weibull",
    position: (r.position as "append" | "prepend") ?? "append",
    timeoutMs: r.timeoutMs ?? 800,
    excludeRecentMS: r.excludeRecentMS ?? 0,
    minResults: r.minResults ?? 0,
    maxChars: r.maxChars ?? 1200,
    scoreThreshold: r.minScore ?? 0.5,
  };
}

// ── Utilities ──
function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function applyDiversitySampling(
  results: SearchResult[],
  baseThreshold: number,
  minThreshold: number,
): SearchResult[] {
  if (results.length <= 1) return results;
  const out: SearchResult[] = [results[0]];
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    let maxSim = 0;
    for (const o of out) {
      const sim = jaccard(r.snippet, o.snippet);
      if (sim > maxSim) maxSim = sim;
    }
    const threshold = Math.max(minThreshold, baseThreshold - (out.length * 0.02));
    if (maxSim < threshold) out.push(r);
  }
  return out;
}

function applyTimeDecay(
  results: SearchResult[],
  halfLifeDays: number,
  mode: "weibull" | "logistic",
): SearchResult[] {
  const now = Date.now();
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return results.map((r) => {
    const ageMs = now - (r.timestamp || now);
    let decay: number;
    if (mode === "logistic") {
      const k = 10 / halfLifeMs;
      const t0 = halfLifeMs;
      decay = 1 / (1 + Math.exp(k * (ageMs - t0)));
    } else {
      const lambda = Math.log(2) / halfLifeMs;
      decay = Math.exp(-lambda * ageMs);
    }
    return { ...r, score: r.score * decay };
  });
}

function applyLengthNormalization(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const len = r.snippet?.length || 1;
    const norm = 1 + Math.log1p(len / 100);
    return { ...r, score: r.score / norm };
  });
}

function applyImportanceWeighting(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const imp = r.importance ?? 0.5;
    return { ...r, score: r.score * (0.5 + imp) };
  });
}

function applyScoring(results: SearchResult[], _userMessage?: string): SearchResult[] {
  return applyImportanceWeighting(applyLengthNormalization(results));
}

function filterByScope(
  results: SearchResult[],
  scopeManager: import("../utils/scope-manager.ts").SimpleScopeManager | undefined,
  agentId: string | undefined,
): SearchResult[] {
  if (!scopeManager || !agentId) return results;
  const allowed = scopeManager.getScopes(agentId);
  return results.filter((r) => !r.scope || allowed.includes(r.scope));
}

function buildRecallContext(results: SearchResult[], hintText?: string, maxChars = 1200): string {
  const header = hintText ? `💡 ${hintText}\n` : "💡 相关记忆:\n";
  let body = "";
  let used = 0;
  for (const r of results) {
    const line = `- ${r.date || ""}: ${r.snippet}\n`;
    if (used + line.length > maxChars) break;
    body += line;
    used += line.length;
  }
  return header + body;
}

function buildHookResult(context: string, _config: YaoyaoMemoryConfig, position: "append" | "prepend"): unknown {
  if (position === "prepend") {
    return { prepend: context };
  }
  return { append: context };
}

// ── Session context accumulation ──
const _sessionContextKeywords = new Map<string, Set<string>>();
const _sessionKeywordOrder = new Map<string, string[]>();

function accumulateKeywords(sessionKey: string, text: string, maxKeywords: number): void {
  const words = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter((w) => w.length >= 2);
  let set = _sessionContextKeywords.get(sessionKey);
  let order = _sessionKeywordOrder.get(sessionKey);
  if (!set) {
    set = new Set();
    order = [];
    _sessionContextKeywords.set(sessionKey, set);
    _sessionKeywordOrder.set(sessionKey, order);
  }
  for (const w of words) {
    if (!set.has(w)) {
      set.add(w);
      order!.push(w);
    }
  }
  while (order!.length > maxKeywords) {
    const removed = order!.shift()!;
    set.delete(removed);
  }
}

function getAccumulatedKeywords(sessionKey: string): string[] {
  return _sessionKeywordOrder.get(sessionKey) || [];
}

// ── Stopword filter ──
function filterStopwords(words: string[]): string[] {
  const stopwords = new Set([
    "可以",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
  ]);

  return words.filter((w) => !stopwords.has(w) && w.length <= 50);
}

export interface RecallHookHandle {
  unregister: () => void;
}

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  audit?: AuditLog,
): RecallHookHandle {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);

  const cfg = getRecallConfig(config);

  const sessionFilter = createSessionFilter({ blockLabels: config.blockLabels || [], blockInternal: true, minMessages: 1 });

  // ── Brain-style LRU result cache ──
  const resultCache = new SimpleLRU<string, SearchResult[]>({
    maxSize: cfg.maxCacheSize,
    ttlMs: cfg.cacheTTL,
  });

  // Brain-style retrieval stats: aggregate query metrics
  const stats = globalRetrievalStats;

  function makeSimpleTrace(query: string, mode: string, startMs: number, inputCount: number, outputCount: number) {
    const totalMs = Date.now() - startMs;
    return {
      query,
      mode: mode as "hybrid" | "fts",
      startedAt: startMs,
      stages: [{ name: "recall", inputCount, outputCount, droppedIds: [], scoreRange: null, durationMs: totalMs }],
      finalCount: outputCount,
      totalMs,
    };
  }

  const handler = async (event: unknown, ctx: unknown) => {
    const recallAsync = async () => {
    try {
      const startMs = Date.now();

      // Session filter: skip internal/system sessions
      const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
      if (!sessionFilter.shouldProcess(sessionKey)) {
        return;
      }

      const e = event as Record<string, unknown>;
      const userMessage = e?.message || e?.prompt;

      // Skip trivial messages
      if (!userMessage || isTrivial(userMessage as string)) {
        return;
      }

      const userText = String(userMessage);

      // ── Brain-style LRU cache ──
      const cacheKey = userText.slice(0, 120);
      const cached = resultCache.get(cacheKey);
      if (cached) {
        if (cached.length > 0) {
          return buildHookResult(buildRecallContext(cached, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
        }
        return;
      }

      // ── Query expansion ──
      const expandedQuery = expandQuery(userText);
      const primaryQuery = expandedQuery || userText;

      // ── Search ──
      let results: SearchResult[] = [];
      let mode = "fts";

      if (embedding?.isAvailable) {
        mode = "hybrid";
        try {
          const userEmbedding = await embedding.embed(userText);
          const vectorResults = db.vectorSearch(userEmbedding, cfg.maxResults * 2);
          if (vectorResults && vectorResults.length > 0) {
            results = vectorResults.map((r) => ({
              ...r,
              score: r.vectorScore ?? r.score ?? 0.5,
            }));
          }
        } catch (vecErr) {
          api.logger.warn?.(`[yaoyao-memory:recall] Vector search failed, falling back to FTS5: ${(vecErr as Error).message}`);
        }
      }

      if (results.length === 0) {
        // Fallback to FTS5
        const ftsResults = db.search(primaryQuery, cfg.maxResults * 2);
        results = ftsResults.map((r) => ({
          ...r,
          score: r.score ?? 0.5,
        }));
        mode = "fts";
      }

      // ── Scope filter ──
      let results2 = filterByScope(results, scopeManager, (ctx as Record<string, unknown>).agentId as string | undefined);

      // ── Time decay ──
      const decayed = applyTimeDecay(results2, cfg.halfLife, cfg.decayMode);

      // ── Scoring ──
      const scored = applyScoring(decayed, userText);

      // ── Sort ──
      const sorted = scored.sort((a, b) => b.score - a.score);

      // ── Diversity sampling ──
      const deduped = applyDiversitySampling(sorted, cfg.jaccardBase, cfg.jaccardMin);

      // ── Limit ──
      let limited = deduped.slice(0, cfg.maxResults);

      // ── Confidence scoring ──
      const confidence = scoreConfidenceSupport(userText, userText);
      if (confidence.score < cfg.scoreThreshold) {
        api.logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}, skipping injection`);
        return;
      }

      // ── Accumulate keywords ──
      accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);

      // ── Cache ──
      resultCache.set(cacheKey, limited);

      // ── Stats ──
      stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, limited.length));

      // ── Audit ──
      if (audit && limited.length > 0) {
        audit.record("recall", { query: userText, results: limited.length, mode, durationMs: Date.now() - startMs });
      }

      // ── Build result ──
      if (limited.length > 0) {
        return buildHookResult(buildRecallContext(limited, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
      }

      return;
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${(err as Error).message}`);
      return;
    }
    };

    // ── Timeout guard ──
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("recall timeout")), cfg.timeoutMs);
    });

    try {
      await Promise.race([recallAsync(), timeoutPromise]);
    } catch (timeoutErr) {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${cfg.timeoutMs}ms, skipping injection`);
    }
  };

  api.on("before_prompt_build", handler);

  return {
    unregister: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api as any).off?.("before_prompt_build", handler);
    },
  };
}
