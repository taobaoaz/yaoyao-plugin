import { globalRetrievalStats } from "../utils/retrieval-stats.js";
import { createSessionFilter } from "../utils/session-filter.js";
import { expandQuery } from "../utils/query-expander.js";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.js";
import { SimpleLRU } from "../utils/simple-lru.js";
import { isTrivial } from "../core/filter/trivial.js";
import { classifyIntent, INTENT_WEIGHTS } from "../core/search/intent.js";
import { getRecallConfig, applyAgentOverrides } from "./recall-config.js";
import { applyTimeDecay, applyScoring, applyDiversitySampling, applyMmrDiversity, filterByScope, } from "./recall-scoring.js";
import { accumulateKeywords } from "./recall-session.js";
// ── Context formatting ──
function buildRecallContext(results, maxChars = 1200) {
    let body = "💡 相关记忆:";
    let used = 0;
    for (const r of results) {
        const line = `\n- ${r.date || ""}: ${r.snippet}`;
        if (used + line.length > maxChars)
            break;
        body += line;
        used += line.length;
    }
    return used > 0 ? body : "";
}
function buildHookResult(context, position) {
    return position === "prepend" ? { prepend: context } : { append: context };
}
function makeSimpleTrace(query, mode, startMs, inputCount, outputCount) {
    const totalMs = Date.now() - startMs;
    return {
        query,
        mode: mode,
        startedAt: startMs,
        stages: [{ name: "recall", inputCount, outputCount, droppedIds: [], scoreRange: null, durationMs: totalMs }],
        finalCount: outputCount,
        totalMs,
    };
}
async function runRecallFilter(candidates, query, cfg) {
    if (!cfg.enableRecallFilter || !cfg.recallFilterModel || !cfg.recallFilterBaseUrl) {
        return candidates;
    }
    if (candidates.length === 0)
        return candidates;
    try {
        // Build a compact prompt that asks the model to classify each item
        const items = candidates.map((c, i) => `[${i}] ${(c.snippet || "").slice(0, cfg.recallFilterMaxItemChars)}`).join("\n");
        const prompt = `Given this user query: "${query.slice(0, 200)}"

Evaluate each memory item below. Respond with indices of items that are RELEVANT and USEFUL.
If none are relevant, respond with "[]".

Items:\n${items}\n\nRelevant indices: [`;
        const response = await fetch(cfg.recallFilterBaseUrl + "/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(cfg.recallFilterApiKey ? { "Authorization": `Bearer ${cfg.recallFilterApiKey}` } : {}),
            },
            body: JSON.stringify({
                model: cfg.recallFilterModel,
                messages: [
                    { role: "system", content: "You are a relevance filter. Only keep items directly answering the query. Return indices as comma-separated numbers inside brackets." },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
                max_tokens: 128,
            }),
            signal: AbortSignal.timeout(cfg.recallFilterTimeoutMs),
        });
        if (!response.ok) {
            if (cfg.recallFilterFailOpen)
                return candidates;
            return [];
        }
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || "";
        // Parse indices like [0, 2, 5] or 0, 2, 5
        const indices = [];
        const match = text.match(/\[(.*?)\]/);
        const raw = match ? match[1] : text;
        for (const part of raw.split(",")) {
            const idx = parseInt(part.trim(), 10);
            if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
                indices.push(idx);
            }
        }
        if (indices.length === 0 && cfg.recallFilterFailOpen)
            return candidates;
        return indices.map(i => candidates[i]);
    }
    catch (err) {
        if (cfg.recallFilterFailOpen)
            return candidates;
        return [];
    }
}
// ── Repeat query detection (MemOS-style) ──
const MAX_RECENT_QUERIES = 20;
const recentQueries = [];
function checkRepeatQuery(query, maxResults, minScore) {
    const normalized = query.toLowerCase().trim();
    if (!normalized)
        return undefined;
    const dup = recentQueries.find((q) => q.query === normalized && q.maxResults === maxResults && q.minScore === minScore);
    if (dup) {
        if (dup.hitCount === 0) {
            return "This exact query with the same parameters was already tried and returned 0 results. Try rephrasing.";
        }
        return "This exact query was already executed. Consider varying the query to get different results.";
    }
    return undefined;
}
function recordRecentQuery(query, maxResults, minScore, hitCount) {
    const normalized = query.toLowerCase().trim();
    if (!normalized)
        return;
    const existing = recentQueries.findIndex((q) => q.query === normalized && q.maxResults === maxResults && q.minScore === minScore);
    if (existing !== -1)
        recentQueries.splice(existing, 1);
    recentQueries.push({ query: normalized, maxResults, minScore, hitCount });
    if (recentQueries.length > MAX_RECENT_QUERIES)
        recentQueries.shift();
}
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
                // LRU cache hit (include agentId in cache key)
                const cacheKey = `${agentId || "default"}:${userText.slice(0, 120)}`;
                const cached = resultCache.get(cacheKey);
                if (cached) {
                    if (cached.length > 0)
                        return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
                    return;
                }
                // Query prefix enhancement (like MemOS queryPrefix)
                // If queryPrefix is set, prepend it to guide memory search semantics
                const prefixedQuery = cfg.queryPrefix ? `${cfg.queryPrefix} ${userText}` : userText;
                // Query expansion
                const expandedQuery = expandQuery(prefixedQuery);
                const primaryQuery = expandedQuery || prefixedQuery;
                // Intent classification for logging (no behavioral change for base search)
                const intent = cfg.enableIntentDriven ? classifyIntent(userText) : undefined;
                // ── Search: intent-driven | vector hybrid | pure FTS ──
                let results = [];
                let mode = "fts";
                if (cfg.enableIntentDriven && embedding?.isAvailable) {
                    // Intent-driven: overfetch + intent-weighted re-rank
                    mode = "intent-driven";
                    const overfetchLimit = cfg.maxResults * 4;
                    try {
                        const queryVec = await embedding.embed(primaryQuery);
                        const vectorResults = db.vectorSearch(queryVec, overfetchLimit);
                        if (vectorResults && vectorResults.length > 0) {
                            results = vectorResults.map(r => ({
                                ...r,
                                score: r.vectorScore ?? r.score ?? 0.5,
                            }));
                        }
                        // Also search FTS for lexical matches
                        const ftsResults = db.search(primaryQuery, overfetchLimit);
                        for (const f of ftsResults) {
                            const exists = results.some(r => r.id === f.id);
                            if (!exists)
                                results.push({ ...f, score: f.score ?? 0.3 });
                        }
                    }
                    catch {
                        // Fallback to FTS
                        results = db.search(primaryQuery, cfg.maxResults * 2).map(r => ({ ...r, score: r.score ?? 0.5 }));
                        mode = "fts";
                    }
                }
                else if (embedding?.isAvailable) {
                    mode = "hybrid";
                    try {
                        const userEmbedding = await embedding.embed(primaryQuery);
                        const vectorResults = db.vectorSearch(userEmbedding, cfg.maxResults * 2);
                        if (vectorResults && vectorResults.length > 0) {
                            results = vectorResults.map((r) => ({
                                ...r,
                                score: r.vectorScore ?? r.score ?? 0.5,
                            }));
                        }
                    }
                    catch (vecErr) {
                        api.logger.warn?.(`[yaoyao-memory:recall] Vector search failed, falling back to FTS5: ${vecErr.message}`);
                    }
                }
                if (results.length === 0) {
                    const ftsResults = db.search(primaryQuery, cfg.maxResults * 2);
                    results = ftsResults.map((r) => ({ ...r, score: r.score ?? 0.5 }));
                    mode = "fts";
                }
                // ── Post-processing pipeline ──
                let processed = filterByScope(results, scopeManager, agentId);
                processed = applyTimeDecay(processed, cfg.halfLife, cfg.decayMode);
                processed = applyScoring(processed, userText);
                processed.sort((a, b) => b.score - a.score);
                // Apply intent-aware re-ranking if intent-driven mode
                if (cfg.enableIntentDriven && intent) {
                    const weights = INTENT_WEIGHTS[intent];
                    for (const r of processed) {
                        // Boost vector score, time-decay the rest
                        const vecScore = typeof r.vectorScore === "number"
                            ? r.vectorScore
                            : r.score;
                        // Temporal score from timestamp if available
                        const ts = r.timestamp;
                        const tempScore = ts ? Math.pow(0.5, (Date.now() - ts) / (30 * 24 * 60 * 60 * 1000)) : 0.5;
                        // Re-score with intent weights
                        r.score = weights.fts * r.score + weights.vector * vecScore + weights.temporal * tempScore;
                    }
                    processed.sort((a, b) => b.score - a.score);
                }
                // ── Diversity: MMR (if enabled) or Jaccard threshold ──
                if (cfg.enableMmr) {
                    processed = applyMmrDiversity(processed, cfg.mmrLambda, cfg.maxResults);
                }
                else {
                    processed = applyDiversitySampling(processed, cfg.jaccardBase, cfg.jaccardMin);
                }
                const limited = processed.slice(0, cfg.maxResults);
                // Confidence threshold
                const confidence = scoreConfidenceSupport(userText, userText);
                if (confidence.score < cfg.scoreThreshold) {
                    api.logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}`);
                    return;
                }
                // ── Model-based recall filter (secondary pass) ──
                const filtered = await runRecallFilter(limited, userText, cfg);
                // Repeat query detection — log a warning if this exact query was already run
                const repeatNote = checkRepeatQuery(userText, cfg.maxResults, cfg.scoreThreshold);
                if (repeatNote) {
                    api.logger.debug?.(`[yaoyao-memory:recall] ${repeatNote}`);
                }
                recordRecentQuery(userText, cfg.maxResults, cfg.scoreThreshold, filtered.length);
                // Session keyword accumulation
                accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);
                // Cache + stats
                resultCache.set(cacheKey, filtered);
                stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, filtered.length));
                if (audit && filtered.length > 0) {
                    audit.record("recall", { query: userText, agentId, mode, results: filtered.length, durationMs: Date.now() - startMs, ...(repeatNote ? { repeatNote } : {}) });
                }
                if (filtered.length > 0) {
                    return buildHookResult(buildRecallContext(filtered, cfg.maxContextChars), cfg.position);
                }
            }
            catch (err) {
                api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${err.message}`);
            }
        };
        // Timeout guard
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
            api.off?.("before_prompt_build", handler);
        },
    };
}
