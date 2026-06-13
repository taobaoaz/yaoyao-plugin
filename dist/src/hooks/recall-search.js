// v1.8.1: Batch-enrich SearchResult[] with access_count from memory_meta
function _enrichAccessCounts(db, results) {
    const ids = results.filter(r => r.id != null).map(r => r.id);
    if (ids.length === 0)
        return;
    try {
        const countMap = db
            .batchGetAccessCounts?.(ids);
        if (countMap) {
            for (const r of results) {
                if (r.id != null && countMap.has(r.id)) {
                    r.accessCount = countMap.get(r.id);
                }
            }
        }
    }
    catch { /* best effort — access_count unavailable, decay uses default */ }
}
export async function doRecallSearch(db, query, cfg, embedding, logger) {
    let results = [];
    let mode = "fts";
    if (cfg.enableIntentDriven && embedding?.isAvailable) {
        mode = "intent-driven";
        const overfetchLimit = cfg.maxResults * 4;
        try {
            const queryVec = await embedding.embed(query);
            const vectorResults = db.vectorSearch(queryVec, overfetchLimit);
            if (vectorResults && vectorResults.length > 0) {
                results = vectorResults.map(r => ({
                    ...r,
                    score: r.vectorScore ?? r.score ?? 0.5,
                }));
            }
            const ftsResults = db.search(query, overfetchLimit);
            for (const f of ftsResults) {
                const exists = results.some(r => r.id === f.id);
                if (!exists)
                    results.push({ ...f, score: f.score ?? 0.3 });
            }
        }
        catch {
            results = db.search(query, cfg.maxResults * 2).map(r => ({ ...r, score: r.score ?? 0.5 }));
            mode = "fts";
        }
    }
    else if (embedding?.isAvailable) {
        mode = "hybrid";
        try {
            const userEmbedding = await embedding.embed(query);
            const vectorResults = db.vectorSearch(userEmbedding, cfg.maxResults * 2);
            if (vectorResults && vectorResults.length > 0) {
                results = vectorResults.map((r) => ({
                    ...r,
                    score: r.vectorScore ?? r.score ?? 0.5,
                }));
            }
        }
        catch (vecErr) {
            logger.warn?.(`[yaoyao-memory:recall] Vector search failed, falling back to FTS5: ${vecErr.message}`);
        }
    }
    if (results.length === 0) {
        const ftsResults = db.search(query, cfg.maxResults * 2);
        results = ftsResults.map((r) => ({ ...r, score: r.score ?? 0.5 }));
        mode = "fts";
    }
    // v1.8.1 (FadeMem): Enrich results with access_count for frequency-adjusted decay
    _enrichAccessCounts(db, results);
    return { results, mode };
}
