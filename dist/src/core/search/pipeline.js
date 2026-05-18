import { multiSignalFusion } from "./multi-signal.js";
import { classifyIntent, INTENT_WEIGHTS } from "./intent.js";
/**
 * Apply intent-aware weights to produce a composite score.
 * Normalizes all scores into a single 0-1 value.
 */
function applyIntentWeights(result, weights) {
    // FTS score: higher = better, typically 0-1 range
    const ftsScore = typeof result.score === "number"
        ? result.score
        : 0.3;
    // Vector score: if EmbeddedSearchResult, use vectorScore or hybridScore
    const vecResult = result;
    const vectorScore = typeof vecResult.vectorScore === "number"
        ? vecResult.vectorScore
        : typeof vecResult.hybridScore === "number"
            ? vecResult.hybridScore
            : ftsScore; // fallback when vector unavailable
    // Temporal recency: check if EmbeddedSearchResult has timestamp
    const timestamp = "timestamp" in result ? result.timestamp : undefined;
    const temporalScore = typeof timestamp === "number" && Number.isFinite(timestamp)
        ? temporalDecay(timestamp, 30) // 30-day half-life
        : 0.5; // neutral if no timestamp
    // Composite: weighted sum
    const compositeScore = (weights.fts * ftsScore +
        weights.vector * vectorScore +
        weights.temporal * temporalScore);
    return {
        compositeScore: Math.min(1, Math.max(0, compositeScore)),
        signals: { fts: ftsScore, vector: vectorScore, temporal: temporalScore },
    };
}
/** Exponential temporal decay: max score for today, half after `halfLifeDays` */
function temporalDecay(timestampMs, halfLifeDays) {
    const ageMs = Date.now() - timestampMs;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays <= 0)
        return 1.0;
    return Math.pow(0.5, ageDays / halfLifeDays);
}
/**
 * Unified search pipeline with intent-aware scoring.
 *
 * Inspired by Cortex Memory's layered retrieval:
 *   score = w_fts × FTS_score + w_vec × vector_score + w_temp × temporal_score
 * where weights are determined by classified query intent.
 */
export function createSearchPipeline(storage, embedding) {
    const hasEmbedding = !!embedding;
    return {
        async search(query, options = {}) {
            const strategy = options.strategy ?? "rrf";
            const limit = options.limit ?? 10;
            const overfetchLimit = limit * 2;
            switch (strategy) {
                case "fts":
                    return storage.search(query, limit);
                case "hybrid": {
                    if (!hasEmbedding || !embedding)
                        return storage.search(query, limit);
                    const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
                    return storage.hybridSearch(query, queryVec, limit);
                }
                case "rrf": {
                    if (!hasEmbedding || !embedding)
                        return storage.search(query, limit);
                    const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
                    return storage.rrfHybridSearch(query, queryVec, limit, options.rrfK ?? 60);
                }
                case "intent-driven": {
                    // Classify intent & pick weights
                    const intent = classifyIntent(query);
                    const weights = options.intentWeights
                        ? { ...INTENT_WEIGHTS[intent], ...options.intentWeights }
                        : INTENT_WEIGHTS[intent];
                    // Fetch raw results (overfetch)
                    let results;
                    if (hasEmbedding && embedding) {
                        const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
                        results = await storage.rrfHybridSearch(query, queryVec, overfetchLimit, options.rrfK ?? 60);
                    }
                    else {
                        results = storage.search(query, overfetchLimit);
                    }
                    // Re-rank by intent-weighted composite score
                    const scored = results.map(r => ({
                        result: r,
                        ...applyIntentWeights(r, weights),
                    }));
                    scored.sort((a, b) => b.compositeScore - a.compositeScore);
                    return scored.slice(0, limit).map(s => ({
                        ...s.result,
                        score: s.compositeScore,
                    }));
                }
                case "multi-signal": {
                    const ftsResults = storage.search(query, overfetchLimit);
                    let vecResults = [];
                    if (hasEmbedding && embedding) {
                        try {
                            const qv = await embedding.embed(query, embedding.recallTimeoutMs);
                            vecResults = storage.vectorSearch(qv, overfetchLimit);
                        }
                        catch { /* vector unavailable */ }
                    }
                    const dummyVec = vecResults.map(r => ({
                        ...r,
                        asst_text: "",
                        timestamp: undefined,
                        importance: undefined,
                        scope: undefined,
                    }));
                    const allResults = dedupSearchResults(ftsResults, vecResults);
                    const entityBoostEnabled = options.entityBoost !== false;
                    const signalConfig = {
                        temporalHalfLifeDays: options.temporalDecayDays ?? 30,
                        entityBoostMax: entityBoostEnabled ? 0.30 : 0,
                    };
                    const fused = multiSignalFusion(query, ftsResults, dummyVec, allResults, signalConfig);
                    return fused.slice(0, limit);
                }
                default:
                    return storage.search(query, limit);
            }
        },
        get hasEmbeddingSupport() {
            return hasEmbedding;
        },
        searchFts(query, limit = 10) {
            return storage.search(query, limit);
        },
        /**
         * Get intent classification + weights without executing the search.
         * Useful for downstream components that want to log or display intent analysis.
         */
        analyzeQuery(query) {
            const intent = classifyIntent(query);
            return { intent, weights: INTENT_WEIGHTS[intent] };
        },
    };
}
/** Re-export INTENT_WEIGHTS for direct use by downstream code */
export { INTENT_WEIGHTS } from "./intent.js";
export { classifyIntent } from "./intent.js";
function dedupSearchResults(fts, vec) {
    const seen = new Set();
    const merged = [];
    for (const r of fts) {
        const key = `${r.id ?? ""}|${r.snippet}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(r);
    }
    for (const r of vec) {
        const key = `${r.id ?? ""}|${r.snippet}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(r);
    }
    return merged;
}
