/**
 * hooks/auto-recall.ts — Auto-recall orchestrator.
 *
 * v1.7.3: Parallel search extracted to recall-parallel.ts.
 * Delegates: config→recall-config, search→recall-search/parallel, postprocess→recall-postprocess.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import { globalRetrievalStats } from "../utils/retrieval-stats.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { expandQuery } from "../utils/query-expander.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { isTrivial } from "../core/filter/trivial.ts";
import { classifyIntent } from "../core/search/intent.ts";
import type { AuditLog } from "../utils/audit-log.ts";
import { getCoexistState } from "../utils/coexistence.ts";
import { createClawBridge } from "../utils/claw-bridge.ts";

import { getRecallConfig, applyAgentOverrides } from "./recall-config.ts";
import { doParallelRecall } from "./recall-parallel.ts";
import { doPostProcess, type PostProcessConfig } from "./recall-postprocess.ts";
import { buildRecallContext, buildHookResult } from "./recall-formatter.ts";

export interface RecallHookHandle { unregister: () => void; }

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  audit?: AuditLog,
): RecallHookHandle {
  const coexist = getCoexistState();
  const useClawPrimary = coexist.flags.useClawPrimaryRecall;
  const clawBridge = useClawPrimary ? createClawBridge() : null;

  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})${clawBridge ? " [coexist: claw-core recall primary]" : ""}`);

  const baseCfg = getRecallConfig(config);
  const sessionFilter = createSessionFilter({ blockLabels: config.blockLabels || [], blockInternal: true, minMessages: 1 });
  const resultCache = new SimpleLRU<string, import("../storage/bridge.ts").SearchResult[]>({ maxSize: baseCfg.maxCacheSize, ttlMs: baseCfg.cacheTTL });
  const stats = globalRetrievalStats;

  const handler = async (event: unknown, ctx: unknown) => {
    const recallAsync = async () => {
      try {
        const startMs = Date.now();
        const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
        if (!sessionFilter.shouldProcess(sessionKey)) return;

        const agentId = (ctx as Record<string, unknown>).agentId as string | undefined;
        const cfg = applyAgentOverrides(baseCfg, agentId);

        const e = event as Record<string, unknown>;
        const userMessage = e?.message || e?.prompt;
        if (!userMessage || isTrivial(userMessage as string)) return;
        const userText = String(userMessage);

        // LRU cache hit
        const cacheKey = `${agentId || "default"}:${userText.slice(0, 120)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
          if (cached.length > 0) return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
          return;
        }

        // Query expansion
        const prefixedQuery = cfg.queryPrefix ? `${cfg.queryPrefix} ${userText}` : userText;
        const primaryQuery = expandQuery(prefixedQuery) || prefixedQuery;
        const intent = cfg.enableIntentDriven ? classifyIntent(userText) : undefined;

        // Parallel search + merge
        const { results: mergedResults, mode: searchMode } = await doParallelRecall(
          db, userText, primaryQuery,
          { enableIntentDriven: cfg.enableIntentDriven, maxResults: cfg.maxResults },
          cfg.maxResults, embedding, clawBridge, api.logger,
        );

        // Post-processing
        return await doPostProcess(
          mergedResults, searchMode, userText, cfg as PostProcessConfig,
          scopeManager, agentId, intent,
          resultCache, stats, startMs, audit, sessionKey, api.logger,
        );
      } catch (err) {
        api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    try {
      await Promise.race([
        recallAsync(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("recall timeout")), baseCfg.timeoutMs)),
      ]);
    } catch (timeoutErr) {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${baseCfg.timeoutMs}ms, skipping`);
    }
  };

  api.on("before_prompt_build", handler);
  return {
    unregister: () => {
      const apiOff = (api as unknown as { off?: (event: string, handler: unknown) => void }).off;
      apiOff?.("before_prompt_build", handler);
    },
  };
}
