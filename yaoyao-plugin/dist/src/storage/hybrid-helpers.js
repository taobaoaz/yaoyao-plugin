export function hybridSearch(db, query, embedding, limit, fts, vector, hybrid) {
    const ftsResults = fts.search(db, query, limit);
    if (!embedding || ftsResults.length === 0) {
        return ftsResults.map(r => ({ ...r, vectorScore: 0, hybridScore: (r.score ?? 0) * 0.6 }));
    }
    const vecResults = vector.search(embedding, limit);
    return hybrid.weighted(ftsResults, vecResults, limit);
}
export function rrfHybridSearch(db, query, embedding, limit, k, fts, vector, hybrid) {
    const overfetchLimit = limit * 2;
    const ftsResults = fts.search(db, query, overfetchLimit);
    if (!embedding || ftsResults.length === 0) {
        return ftsResults.slice(0, limit).map(r => ({ ...r, vectorScore: 0, hybridScore: r.score }));
    }
    const vecResults = vector.search(embedding, overfetchLimit);
    return hybrid.rrf(ftsResults, vecResults, limit);
}
