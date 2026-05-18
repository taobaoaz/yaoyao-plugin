import { multiSignalFusion } from "./multi-signal.js";
/**
 * Unified search pipeline. Each search() call can use a different strategy.
 * No internal state — safe to reuse across requests.
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
                    // Cast to satisfy TS union type — MultiSignalResult has more fields than SearchResult
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
    };
}
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
