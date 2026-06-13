/**
 * Reciprocal Rank Fusion (RRF) — combine multiple ranked lists into one.
 *
 * Formula: score = Σ 1/(k + rank_i) for each list where the doc appears.
 * k = 60 is the common default (tuned for ranked lists of ~10-100 items).
 *
 * All zero-dependency.
 */
const DEFAULT_K = 60;
/**
 * Fuse multiple ranked lists into a single ranked list using RRF.
 *
 * @param lists — array of ranked lists, each ordered best→worst
 * @param k — RRF constant (default 60)
 * @returns — fused list ordered by RRF score descending
 */
export function reciprocalRankFusion(lists, k = DEFAULT_K) {
    const scores = new Map();
    for (let listIdx = 0; listIdx < lists.length; listIdx++) {
        const list = lists[listIdx];
        for (let rank = 0; rank < list.length; rank++) {
            const item = list[rank];
            const existing = scores.get(item.id);
            if (existing) {
                existing.score += 1 / (k + rank);
                existing.ranks[listIdx] = rank;
                // Merge doc fields (later lists win on key conflicts)
                Object.assign(existing.doc, item.doc);
            }
            else {
                const ranks = new Array(lists.length).fill(-1);
                ranks[listIdx] = rank;
                scores.set(item.id, {
                    score: 1 / (k + rank),
                    ranks,
                    doc: { ...item.doc, originalScore: item.originalScore },
                });
            }
        }
    }
    const results = [];
    for (const [id, val] of scores) {
        results.push({ id, rrfScore: val.score, ranks: val.ranks, doc: val.doc });
    }
    return results.sort((a, b) => b.rrfScore - a.rrfScore);
}
/**
 * Convenience: fuse two lists (FTS5 + vector) with a score threshold filter.
 */
export function fuseFTSAndVector(ftsResults, vecResults, k = DEFAULT_K, minScoreThreshold = 0) {
    const ftsRanked = ftsResults.map(r => ({ id: r.id, doc: r, originalScore: r.score }));
    const vecRanked = vecResults.map(r => ({ id: r.id, doc: r, originalScore: r.score }));
    const fused = reciprocalRankFusion([ftsRanked, vecRanked], k);
    return fused
        .filter(r => minScoreThreshold <= 0 || r.rrfScore >= minScoreThreshold)
        .map(r => ({
        id: r.id,
        rrfScore: r.rrfScore,
        ftsScore: (r.ranks[0] >= 0 ? ftsResults[r.ranks[0]].score : 0),
        vecScore: (r.ranks[1] >= 0 ? vecResults[r.ranks[1]].score : 0),
        ...r.doc,
    }));
}
