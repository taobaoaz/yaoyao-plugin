/**
 * hooks/auto-recall.ts — Auto-recall orchestrator.
 *
 * Uses api.on("before_prompt_build", ...) to inject relevant memories
 * into the prompt context via FTS5 + optional vector search.
 *
 * v1.7.0:
 *   - Per-agent overrides (maxResults, scoreThreshold, queryPrefix, etc.)
 *   - Intent-driven search strategy (auto-classifies query, applies weights)
 *   - Query prefix enhancement (like queryPrefix)
 *   - Secondary model-based recall filtering (like recallFilter)
 *   - Configurable maxContextChars for injection budget
 *
 * Scoring, config, and session tracking are in sibling modules:
 *   recall-config.ts   — config type + extraction + per-agent merge
 *   recall-scoring.ts  — time decay, diversity, normalization
 *   recall-session.ts  — keyword accumulation
 *   recall-filter.ts   — model-based secondary filter
 *   recall-query-cache.ts — repeat query detection
 */
import type { OpenClawPluginApi } from "../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import { RetrievalStatsCollector, globalRetrievalStats } from "../utils/retrieval-stats.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { expandQuery } from "../utils/query-expander.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { isTrivial } from "../core/filter/trivial.ts";
import { classifyIntent } from "../core/search/intent.ts";
import type { AuditLog } from "../utils/audit-log.ts";

import { getRecallConfig, applyAgentOverrides, type RecallThresholds } from "./recall-config.ts";
import { doRecallSearch, type RecallSearchConfig } from "./recall-search.ts";
import { doPostProcess, type PostProcessConfig } from "./recall-postprocess.ts";
import { getGlobalEpisodicCache } from "../core/episodic/episodic-cache.ts";
import { buildRecallContext, buildHookResult, makeSimpleTrace } from "./recall-formatter.ts";

export interface RecallHookHandle {
  unregister: () => void;
}

// ── Main hook registration ──

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  audit?: AuditLog,
): RecallHookHandle {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);

  const baseCfg = getRecallConfig(config);
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  // Brain-style LRU result cache
  const resultCache = new SimpleLRU<string, SearchResult[]>({
    maxSize: baseCfg.maxCacheSize,
    ttlMs: baseCfg.cacheTTL,
  });
  const stats = globalRetrievalStats;

  const handler = async (event: unknown, ctx: unknown) => {
    const recallAsync = async () => {
      try {
        const startMs = Date.now();
        const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
        if (!sessionFilter.shouldProcess(sessionKey)) return;

        const agentId = (ctx as Record<string, unknown>).agentId as string | undefined;

        // Apply per-agent overrides
        const cfg = applyAgentOverrides(baseCfg, agentId);

        const e = event as Record<string, unknown>;
        const userMessage = e?.message || e?.prompt;
        if (!userMessage || isTrivial(userMessage as string)) return;

        const userText = String(userMessage);

        // v1.8.2 (Dual Process): Check episodic cache first — fast exact/near-match for recent context
        const episodicCache = getGlobalEpisodicCache();
        const episodicHits = episodicCache.query(userText, sessionKey, baseCfg.maxResults);
        if (episodicHits.length > 0) {
          const formatted: SearchResult[] = episodicHits.map(e => ({
            filename: "episodic",
            snippet: `${e.userText} ${e.asstText}`,
            score: e.value ?? 0.5,
            date: new Date(e.timestamp).toISOString().slice(0, 10),
            asst_text: e.asstText,
          }));
          api.logger.debug?.(`[yaoyao-memory:recall] Episodic hit: ${episodicHits.length} entries`);
          return buildHookResult(buildRecallContext(formatted, cfg.maxContextChars), cfg.position);
        }

        // LRU cache hit (include agentId in cache key)
        const cacheKey = `${agentId || "default"}:${userText.slice(0, 120)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
          if (cached.length > 0) return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
          return;
        }

        // Query prefix enhancement (like queryPrefix)
        // If queryPrefix is set, prepend it to guide memory search semantics
        const prefixedQuery = cfg.queryPrefix ? `${cfg.queryPrefix} ${userText}` : userText;

        // Query expansion
        const expandedQuery = expandQuery(prefixedQuery);
        const primaryQuery = expandedQuery || prefixedQuery;

        // Intent classification for logging (no behavioral change for base search)
        const intent = cfg.enableIntentDriven ? classifyIntent(userText) : undefined;

        // ── Search: intent-driven | vector hybrid | pure FTS ──
        const searchCfg: RecallSearchConfig = {
          enableIntentDriven: cfg.enableIntentDriven,
          maxResults: cfg.maxResults,
        };
        const { results, mode } = await doRecallSearch(db, primaryQuery, searchCfg, embedding, api.logger);

        // ── Post-processing pipeline ──
        const ppResult = await doPostProcess(
          results, mode, userText, cfg as PostProcessConfig,
          scopeManager, agentId, intent,
          resultCache, stats, startMs, audit, sessionKey, api.logger, db,
        );
        return ppResult;
      } catch (err) {
        api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${(err as Error).message}`);
      }
    };

    // Timeout guard
    try {
      const result = await Promise.race([
        recallAsync(),
        new Promise<ReturnType<typeof recallAsync>>((_, reject) => setTimeout(() => reject(new Error("recall timeout")), baseCfg.timeoutMs)),
      ]);
      return result;
    } catch (timeoutErr) {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${baseCfg.timeoutMs}ms, skipping`);
    }
  };

  api.on("before_prompt_build", handler);

  return {
    unregister: () => {
      (api as unknown as { off?: (event: string, handler: unknown) => void }).off?.("before_prompt_build", handler);
    },
  };
}
