/**
 * hooks/auto-recall.ts — Auto-recall orchestrator.
 *
 * v1.7.2: Parallel search extracted to recall-parallel.ts.
 * Delegates: config→recall-config, search→recall-search/parallel, postprocess→recall-postprocess.
 */
import { globalRetrievalStats } from "../utils/retrieval-stats.js";
import { createSessionFilter } from "../utils/session-filter.js";
import { expandQuery } from "../utils/query-expander.js";
import { SimpleLRU } from "../utils/simple-lru.js";
import { isTrivial } from "../core/filter/trivial.js";
import { classifyIntent } from "../core/search/intent.js";
import { getCoexistState } from "../utils/coexistence.js";
import { createClawBridge } from "../utils/claw-bridge.js";
import { getRecallConfig, applyAgentOverrides } from "./recall-config.js";
import { doParallelRecall } from "./recall-parallel.js";
import { doPostProcess } from "./recall-postprocess.js";
import { buildRecallContext, buildHookResult } from "./recall-formatter.js";
export function registerRecallHook(api, db, config, embedding, scopeManager, audit) {
    const coexist = getCoexistState();
    const useClawPrimary = coexist.flags.useClawPrimaryRecall;
    const clawBridge = useClawPrimary ? createClawBridge() : null;
    api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})${clawBridge ? " [coexist: claw-core recall primary]" : ""}`);
    const baseCfg = getRecallConfig(config);
    const sessionFilter = createSessionFilter({ blockLabels: config.blockLabels || [], blockInternal: true, minMessages: 1 });
    const resultCache = new SimpleLRU({ maxSize: baseCfg.maxCacheSize, ttlMs: baseCfg.cacheTTL });
    const stats = globalRetrievalStats;
    const handler = async (event, ctx) => {
        const recallAsync = async () => {
            try {
                const startMs = Date.now();
                const sessionKey = ctx.sessionKey || "default";
                if (!sessionFilter.shouldProcess(sessionKey))
                    return;
                const agentId = ctx.agentId;
                const cfg = applyAgentOverrides(baseCfg, agentId);
                const e = event;
                const userMessage = e?.message || e?.prompt;
                if (!userMessage || isTrivial(userMessage))
                    return;
                const userText = String(userMessage);
                // LRU cache hit
                const cacheKey = `${agentId || "default"}:${userText.slice(0, 120)}`;
                const cached = resultCache.get(cacheKey);
                if (cached) {
                    if (cached.length > 0)
                        return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
                    return;
                }
                // Query expansion
                const prefixedQuery = cfg.queryPrefix ? `${cfg.queryPrefix} ${userText}` : userText;
                const primaryQuery = expandQuery(prefixedQuery) || prefixedQuery;
                const intent = cfg.enableIntentDriven ? classifyIntent(userText) : undefined;
                // Parallel search + merge
                const { results: mergedResults, mode: searchMode } = await doParallelRecall(db, userText, primaryQuery, { enableIntentDriven: cfg.enableIntentDriven, maxResults: cfg.maxResults }, cfg.maxResults, embedding, clawBridge, api.logger);
                // Post-processing
                return await doPostProcess(mergedResults, searchMode, userText, cfg, scopeManager, agentId, intent, resultCache, stats, startMs, audit, sessionKey, api.logger);
            }
            catch (err) {
                api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${err instanceof Error ? err.message : String(err)}`);
            }
        };
        try {
            await Promise.race([
                recallAsync(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("recall timeout")), baseCfg.timeoutMs)),
            ]);
        }
        catch (timeoutErr) {
            api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${baseCfg.timeoutMs}ms, skipping`);
        }
    };
    api.on("before_prompt_build", handler);
    return {
        unregister: () => {
            const apiOff = api.off;
            apiOff?.("before_prompt_build", handler);
        },
    };
}
