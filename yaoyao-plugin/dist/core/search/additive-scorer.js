/**
 * core/search/additive-scorer.ts — Additive scoring fusion.
 *
 * Alternative to RRF. Instead of ranking-position fusion, additive scoring
 * directly combines the signal scores (semantic + BM25 + entity boost)
 * with adaptive normalization.
 *
 * Key differences from RRF:
 *   RRF:         1/(k+rank) — rank-based, ignores score magnitude
 *   Additive:    (semantic + BM25 + entity) / max_possible — score-based
 */
import { getBM25SigmoidParams, normalizeBM25Score, scoreBM25, buildBM25Index } from "./bm25.js";
import { extractEntities, computeEntityBoost } from "./entity-extractor.js";
const DEFAULT_CONFIG = {
    entityBoostWeight: 0.5,
    semanticThreshold: 0,
    useBM25: true,
    useEntityBoost: true,
    topK: 10,
};
// ── Main scorer ──
/**
 * Score candidates additively and return top-k results.
 *
 *   1. Extract entities from query
 *   2. For each candidate:
 *      a. Get semantic score
 *      b. If semantic < threshold, skip
 *      c. Compute BM25 score (normalized to [0,1] via sigmoid)
 *      d. Compute entity boost (Jaccard overlap)
 *      e. combined = (semantic + bm25 + entity * weight) / max_possible
 *   3. Sort descending, return top-k
 *
 * @param query — Original search query
 * @param candidates — Objects with id, snippet, semanticScore, date, filename
 * @param config — Tunable parameters
 * @returns — Scored, ranked, sliced to top-k
 */
export function additiveScoreAndRank(query, candidates, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (candidates.length === 0)
        return [];
    // 1. Extract query entities
    const queryEntities = extractEntities(query);
    // 2. BM25 scoring (if enabled)
    const bm25Scores = new Map();
    if (cfg.useBM25) {
        const texts = candidates.map((c) => c.snippet);
        const ids = candidates.map((c) => String(c.id));
        const bm25Index = buildBM25Index(texts, ids);
        const bm25Params = getBM25SigmoidParams(query);
        const scored = scoreBM25(bm25Index, query);
        for (const s of scored) {
            bm25Scores.set(s.id, normalizeBM25Score(s.score, bm25Params));
        }
    }
    // 3. Determine active signals for adaptive denominator
    const hasBM25 = cfg.useBM25 && bm25Scores.size > 0;
    const hasEntity = cfg.useEntityBoost;
    let maxPossible = 1.0; // semantic base
    if (hasBM25)
        maxPossible += 1.0;
    if (hasEntity)
        maxPossible += cfg.entityBoostWeight;
    // 4. Score each candidate
    const scored = [];
    for (const c of candidates) {
        const semantic = c.semanticScore;
        // Threshold gate: skip low semantic candidates
        if (cfg.semanticThreshold > 0 && semantic < cfg.semanticThreshold) {
            continue;
        }
        // BM25 score
        const bm25 = hasBM25 ? (bm25Scores.get(c.id) ?? 0) : 0;
        // Entity boost
        let entityBoost = 0;
        if (hasEntity) {
            const memoryEntities = extractEntities(c.snippet);
            const boost = computeEntityBoost(queryEntities, memoryEntities);
            entityBoost = boost;
        }
        // Combined score
        const raw = semantic + bm25 + entityBoost * cfg.entityBoostWeight;
        const combined = Math.min(raw / maxPossible, 1.0);
        scored.push({
            id: c.id,
            snippet: c.snippet,
            score: combined,
            signals: { semantic, bm25, entityBoost },
            date: c.date,
            filename: c.filename,
        });
    }
    // 5. Sort descending, return top-k
    return scored.sort((a, b) => b.score - a.score).slice(0, cfg.topK);
}
/**
 * Format additive scorer results for human reading.
 */
export function formatAdditiveResults(results, query) {
    if (results.length === 0)
        return '没有找到相关记忆。';
    const lines = [
        `## 搜索结果（Additive Scoring）`,
        `查询: ${query}`,
        `融合: 语义 + BM25 + 实体增强`,
        '',
    ];
    for (const r of results) {
        const signalParts = [
            `语义:${(r.signals.semantic * 100).toFixed(0)}%`,
            r.signals.bm25 > 0 ? `BM25:${(r.signals.bm25 * 100).toFixed(0)}%` : '',
            r.signals.entityBoost > 0 ? `实体:×${(1 + r.signals.entityBoost * 0.5).toFixed(2)}` : '',
        ]
            .filter(Boolean)
            .join(' ');
        const meta = [(r.score * 100).toFixed(0) + '%', r.date, r.filename || `id:${r.id}`, signalParts]
            .filter(Boolean)
            .join(' · ');
        lines.push(`**${meta}**`);
        lines.push(`${r.snippet.slice(0, 300)}`);
        lines.push('');
    }
    lines.push(`---\n共 ${results.length} 条结果（Additive Scoring 融合）`);
    return lines.join('\n');
}
