import { multiSignalFusion } from "./multi-signal.js";
import { classifyIntent, INTENT_WEIGHTS } from "./intent.js";
import { applyIntentWeights, dedupSearchResults } from "./pipeline-scoring.js";
/**
 * Unified search pipeline with intent-aware scoring.
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
                    const intent = classifyIntent(query);
                    const weights = options.intentWeights
                        ? { ...INTENT_WEIGHTS[intent], ...options.intentWeights }
                        : INTENT_WEIGHTS[intent];
                    let results;
                    if (hasEmbedding && embedding) {
                        const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
                        results = await storage.rrfHybridSearch(query, queryVec, overfetchLimit, options.rrfK ?? 60);
                    }
                    else {
                        results = storage.search(query, overfetchLimit);
                    }
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
                        catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            console.warn(`[yaoyao-memory:search] Vector search failed: ${msg}`);
                        }
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
        analyzeQuery(query) {
            const intent = classifyIntent(query);
            return { intent, weights: INTENT_WEIGHTS[intent] };
        },
    };
}
export { INTENT_WEIGHTS } from "./intent.js";
export { classifyIntent } from "./intent.js";
