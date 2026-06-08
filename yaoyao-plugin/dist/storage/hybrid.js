import { reciprocalRankFusion } from "../core/search/rrf.js";
const DEFAULT_HYBRID = {
    rrfK: 60,
    overfetchMultiplier: 2,
};
export function createHybridSearch(config) {
    const cfg = { ...DEFAULT_HYBRID, ...config };
    return {
        /**
         * Weighted combination hybrid: FTS5 score * 0.6 + vector * 0.4.
         * Used when RRF is not desired.
         */
        weighted(ftsResults, vecResults, limit) {
            if (ftsResults.length === 0 && vecResults.length === 0)
                return [];
            const merged = new Map();
            for (const r of ftsResults) {
                merged.set(`${r.date}|${r.snippet}|${r.id}`, {
                    ...r,
                    vectorScore: 0,
                    hybridScore: (r.score ?? 0) * 0.6,
                });
            }
            for (const r of vecResults) {
                const key = `${r.date}|${r.snippet}|${r.id}`;
                if (merged.has(key)) {
                    const existing = merged.get(key);
                    existing.vectorScore = r.vectorScore;
                    existing.hybridScore = existing.score * 0.6 + r.vectorScore * 0.4;
                }
                else {
                    merged.set(key, {
                        ...r,
                        score: r.vectorScore * 0.4,
                        hybridScore: r.vectorScore * 0.4,
                    });
                }
            }
            return [...merged.values()].sort((a, b) => b.hybridScore - a.hybridScore).slice(0, limit);
        },
        /**
         * RRF (Reciprocal Rank Fusion) hybrid search.
         * Fuses FTS5 and vector rankings independently, then combines via 1/(k+rank).
         */
        rrf(ftsResults, vecResults, limit) {
            if (ftsResults.length === 0 && vecResults.length === 0)
                return [];
            const ftsRanked = ftsResults.map((r, i) => ({
                id: `${r.date}|${r.snippet}|${r.id || i}`,
                doc: { ...r, source: 'fts' },
                originalScore: r.score,
            }));
            const vecRanked = vecResults.map((r, i) => ({
                id: `${r.date}|${r.snippet}|${r.id || i}`,
                doc: { ...r, source: 'vec' },
                originalScore: r.vectorScore,
            }));
            const fused = reciprocalRankFusion([ftsRanked, vecRanked], cfg.rrfK);
            const results = [];
            for (const f of fused.slice(0, limit)) {
                const doc = f.doc;
                results.push({
                    id: doc.id,
                    filename: String(doc.filename || ''),
                    snippet: String(doc.snippet || ''),
                    score: Number(doc.originalScore || 0),
                    date: String(doc.date || ''),
                    vectorScore: f.ranks[1] >= 0 ? Number(doc.originalScore || 0) : 0,
                    hybridScore: f.rrfScore,
                });
            }
            return results;
        },
    };
}
