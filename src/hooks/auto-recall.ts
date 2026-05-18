/**
 * hooks/auto-recall.ts — Auto-recall orchestrator.
 *
 * Uses api.on("before_prompt_build", ...) to inject relevant memories
 * into the prompt context via FTS5 + optional vector search.
 *
 * Scoring, config, and session tracking are in sibling modules:
 *   recall-config.ts   — config type + extraction
 *   recall-scoring.ts  — time decay, diversity, normalization
 *   recall-session.ts  — keyword accumulation
 *
 * v1.5.0+: Removed L4 feedback tracking and persona state injection.
 *          Feedback learning moved to yaoyao-soul.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import { RetrievalStatsCollector, globalRetrievalStats } from "../utils/retrieval-stats.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { expandQuery } from "../utils/query-expander.ts";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { isTrivial } from "../core/filter/trivial.ts";
import type { AuditLog } from "../utils/audit-log.ts";

import { getRecallConfig, type RecallThresholds } from "./recall-config.ts";
import {
  applyTimeDecay,
  applyScoring,
  applyDiversitySampling,
  filterByScope,
} from "./recall-scoring.ts";
import { accumulateKeywords } from "./recall-session.ts";

export interface RecallHookHandle {
  unregister: () => void;
}

function buildRecallContext(results: SearchResult[], maxChars = 1200): string {
  let body = "💡 相关记忆:\n";
  let used = 0;
  for (const r of results) {
    const line = `- ${r.date || ""}: ${r.snippet}\n`;
    if (used + line.length > maxChars) break;
    body += line;
    used += line.length;
  }
  return body;
}

function buildHookResult(context: string, position: "append" | "prepend"): unknown {
  return position === "prepend" ? { prepend: context } : { append: context };
}

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
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  // Brain-style LRU result cache
  const resultCache = new SimpleLRU<string, SearchResult[]>({
    maxSize: cfg.maxCacheSize,
    ttlMs: cfg.cacheTTL,
  });
  const stats = globalRetrievalStats;

  const handler = async (event: unknown, ctx: unknown) => {
    const recallAsync = async () => {
      try {
        const startMs = Date.now();
        const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
        if (!sessionFilter.shouldProcess(sessionKey)) return;

        const e = event as Record<string, unknown>;
        const userMessage = e?.message || e?.prompt;
        if (!userMessage || isTrivial(userMessage as string)) return;

        const userText = String(userMessage);

        // LRU cache hit
        const cacheKey = userText.slice(0, 120);
        const cached = resultCache.get(cacheKey);
        if (cached) {
          if (cached.length > 0) return buildHookResult(buildRecallContext(cached, cfg.maxChars), cfg.position);
          return;
        }

        // Query expansion
        const expandedQuery = expandQuery(userText);
        const primaryQuery = expandedQuery || userText;

        // Search (vector first, fallback to FTS)
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
          const ftsResults = db.search(primaryQuery, cfg.maxResults * 2);
          results = ftsResults.map((r) => ({ ...r, score: r.score ?? 0.5 }));
          mode = "fts";
        }

        // Post-processing pipeline
        let processed = filterByScope(results, scopeManager, (ctx as Record<string, unknown>).agentId as string | undefined);
        processed = applyTimeDecay(processed, cfg.halfLife, cfg.decayMode);
        processed = applyScoring(processed, userText);
        processed.sort((a, b) => b.score - a.score);
        processed = applyDiversitySampling(processed, cfg.jaccardBase, cfg.jaccardMin);
        const limited = processed.slice(0, cfg.maxResults);

        // Confidence threshold
        const confidence = scoreConfidenceSupport(userText, userText);
        if (confidence.score < cfg.scoreThreshold) {
          api.logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}`);
          return;
        }

        // Session keyword accumulation
        accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);

        // Cache + stats
        resultCache.set(cacheKey, limited);
        stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, limited.length));

        if (audit && limited.length > 0) {
          audit.record("recall", { query: userText, results: limited.length, mode, durationMs: Date.now() - startMs });
        }

        if (limited.length > 0) {
          return buildHookResult(buildRecallContext(limited, cfg.maxChars), cfg.position);
        }
      } catch (err) {
        api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${(err as Error).message}`);
      }
    };

    // Timeout guard
    try {
      await Promise.race([
        recallAsync(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("recall timeout")), cfg.timeoutMs)),
      ]);
    } catch (timeoutErr) {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${cfg.timeoutMs}ms, skipping`);
    }
  };

  api.on("before_prompt_build", handler);

  return {
    unregister: () => {
      (api as unknown as { off?: (event: string, handler: unknown) => void }).off?.("before_prompt_build", handler);
    },
  };
}
