import { globalRetrievalStats } from "../utils/retrieval-stats.js";
import { createSessionFilter } from "../utils/session-filter.js";
import { expandQuery } from "../utils/query-expander.js";
import { SimpleLRU } from "../utils/simple-lru.js";
import { isTrivial } from "../core/filter/trivial.js";
import { classifyIntent } from "../core/search/intent.js";
import { getRecallConfig, applyAgentOverrides } from "./recall-config.js";
import { doRecallSearch } from "./recall-search.js";
import { doPostProcess } from "./recall-postprocess.js";
import { getGlobalEpisodicCache } from "../core/episodic/episodic-cache.js";
import { buildRecallContext, buildHookResult } from "./recall-formatter.js";
// ── Main hook registration ──
export function registerRecallHook(api, db, config, embedding, scopeManager, audit) {
    api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);
    const baseCfg = getRecallConfig(config);
    const sessionFilter = createSessionFilter({
        blockLabels: config.blockLabels || [],
        blockInternal: true,
        minMessages: 1,
    });
    // Brain-style LRU result cache
    const resultCache = new SimpleLRU({
        maxSize: baseCfg.maxCacheSize,
        ttlMs: baseCfg.cacheTTL,
    });
    const stats = globalRetrievalStats;
    const handler = async (event, ctx) => {
        const recallAsync = async () => {
            try {
                const startMs = Date.now();
                const sessionKey = ctx.sessionKey || "default";
                if (!sessionFilter.shouldProcess(sessionKey))
                    return;
                const agentId = ctx.agentId;
                // Apply per-agent overrides
                const cfg = applyAgentOverrides(baseCfg, agentId);
                const e = event;
                const userMessage = e?.message || e?.prompt;
                if (!userMessage || isTrivial(userMessage))
                    return;
                const userText = String(userMessage);
                // v1.8.2 (Dual Process): Check episodic cache first — fast exact/near-match for recent context
                const episodicCache = getGlobalEpisodicCache();
                const episodicHits = episodicCache.query(userText, sessionKey, baseCfg.maxResults);
                if (episodicHits.length > 0) {
                    const formatted = episodicHits.map(e => ({
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
                    if (cached.length > 0)
                        return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
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
                const searchCfg = {
                    enableIntentDriven: cfg.enableIntentDriven,
                    maxResults: cfg.maxResults,
                };
                const { results, mode } = await doRecallSearch(db, primaryQuery, searchCfg, embedding, api.logger);
                // ── Post-processing pipeline ──
                const ppResult = await doPostProcess(results, mode, userText, cfg, scopeManager, agentId, intent, resultCache, stats, startMs, audit, sessionKey, api.logger, db);
                return ppResult;
            }
            catch (err) {
                api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${err.message}`);
            }
        };
        // Timeout guard
        try {
            const result = await Promise.race([
                recallAsync(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("recall timeout")), baseCfg.timeoutMs)),
            ]);
            return result;
        }
        catch (timeoutErr) {
            api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${baseCfg.timeoutMs}ms, skipping`);
        }
    };
    api.on("before_prompt_build", handler);
    return {
        unregister: () => {
            api.off?.("before_prompt_build", handler);
        },
    };
}
