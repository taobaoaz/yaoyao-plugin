/** Jaccard similarity between two strings (word-based) */
export function jaccard(a, b) {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}
/**
 * Maximal Marginal Relevance (MMR) re-ranking.
 *
 * Balances relevance with diversity. Uses Jaccard similarity on snippet
 * text as the diversity metric (no vector embeddings needed at recall time).
 *
 * MMR = λ · score(q,d) - (1-λ) · max_j(Jaccard(d, d_j_selected))
 *
 * Local memory system uses λ=0.7 as default.
 * When λ=1.0, behaves like standard top-K (no diversity).
 * When λ=0.5, equal weight on relevance and diversity.
 */
export function applyMmrDiversity(results, lambda = 0.7, topK = undefined) {
    if (results.length <= 1)
        return results;
    const k = topK ?? results.length;
    const selected = [];
    const remaining = [...results];
    while (selected.length < k && remaining.length > 0) {
        let bestIdx = 0;
        let bestMmr = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i];
            // Relevance to query = candidate score (already normalized from pipeline)
            const relevance = cand.score;
            // Diversity penalty: max Jaccard similarity to any selected item
            let maxSimToSelected = 0;
            if (selected.length > 0) {
                for (const sel of selected) {
                    const sim = jaccard(cand.snippet, sel.snippet);
                    if (sim > maxSimToSelected)
                        maxSimToSelected = sim;
                }
            }
            const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;
            if (mmrScore > bestMmr) {
                bestMmr = mmrScore;
                bestIdx = i;
            }
        }
        selected.push(remaining.splice(bestIdx, 1)[0]);
    }
    return selected;
}
/** Diversity sampling: keep results that differ from each other (original greedy method) */
export function applyDiversitySampling(results, baseThreshold, minThreshold) {
    if (results.length <= 1)
        return results;
    const out = [results[0]];
    for (let i = 1; i < results.length; i++) {
        const r = results[i];
        let maxSim = 0;
        for (const o of out) {
            const sim = jaccard(r.snippet, o.snippet);
            if (sim > maxSim)
                maxSim = sim;
        }
        const threshold = Math.max(minThreshold, baseThreshold - (out.length * 0.02));
        if (maxSim < threshold)
            out.push(r);
    }
    return out;
}
/** v1.8.1 (FadeMem): Access-frequency factor for decay modulation.
 * Frequently recalled memories decay slower.
 * Formula: effectiveHalfLife = halfLifeDays * (1 + accessFactor * log(1 + accessCount))
 * accessFactor=0 disables FadeMem (pure fixed half-life, v1.7.9 behavior).
 * accessFactor=0.3 (default) means accessCount=10 → half-life ×2.3, accessCount=100 → half-life ×3.4
 */
export function applyTimeDecay(results, halfLifeDays, mode, accessFactor = 0.3) {
    const now = Date.now();
    const baseHalfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    return results.map((r) => {
        const ageMs = now - (r.timestamp || now);
        // FadeMem: modulate half-life by access frequency
        const accessCount = r.accessCount ?? 0;
        const fadeMultiplier = accessFactor > 0 && accessCount > 0
            ? 1 + accessFactor * Math.log(1 + accessCount)
            : 1;
        const halfLifeMs = baseHalfLifeMs * fadeMultiplier;
        let decay;
        if (mode === "logistic") {
            const k = 10 / halfLifeMs;
            const t0 = halfLifeMs;
            decay = 1 / (1 + Math.exp(k * (ageMs - t0)));
        }
        else {
            const lambda = Math.log(2) / halfLifeMs;
            decay = Math.exp(-lambda * ageMs);
        }
        return { ...r, score: r.score * decay };
    });
}
/** Penalize very long snippets (prevents verbatim dumping) */
export function applyLengthNormalization(results) {
    return results.map((r) => {
        const len = r.snippet?.length || 1;
        const norm = 1 + Math.log1p(len / 100);
        return { ...r, score: r.score / norm };
    });
}
/** Boost by importance weight (if available) */
export function applyImportanceWeighting(results) {
    return results.map((r) => {
        const imp = r.importance ?? 0.5;
        return { ...r, score: r.score * (0.5 + imp) };
    });
}
/** v1.8.2 (SmartVector): Parse metadata JSON from SearchResult for signal extraction */
function parseMetadata(r) {
    if (!r.metadata)
        return {};
    try {
        return JSON.parse(r.metadata);
    }
    catch {
        return {};
    }
}
/**
 * v1.8.2 (SmartVector): Four-signal fusion scoring.
 * Paper: SmartVector (arXiv:2604.20598) — replace pure cosine/FTS score with
 * a four-signal blend: semantic relevance + temporal validity + live confidence
 * + relational importance.
 *
 * score = w_sem * semantic + w_temp * temporal + w_conf * confidence + w_rel * relational
 *
 * Each signal is normalized to [0,1]. Default weights: 0.4/0.2/0.2/0.2.
 * Falls back gracefully when metadata is missing (uses semantic only).
 */
export function applyFourSignalFusion(results, weights) {
    const w = {
        semantic: weights?.semantic ?? 0.4,
        temporal: weights?.temporal ?? 0.2,
        confidence: weights?.confidence ?? 0.2,
        relational: weights?.relational ?? 0.2,
    };
    return results.map((r) => {
        const meta = parseMetadata(r);
        const semanticScore = Math.max(0, Math.min(1, r.score));
        // Signal 2: Temporal validity — penalize expired or near-expiry memories
        let temporalScore = 1.0;
        const expiryAt = meta.expiryAt;
        if (expiryAt) {
            const expiryMs = new Date(expiryAt).getTime();
            const nowMs = Date.now();
            if (nowMs > expiryMs) {
                temporalScore = 0.1; // expired — heavily penalize but don't zero (may still be relevant)
            }
            else {
                const remainingMs = expiryMs - nowMs;
                const dayMs = 24 * 60 * 60 * 1000;
                // Linear ramp: 0 days remaining → 0.3, 7+ days → 1.0
                temporalScore = Math.min(1.0, 0.3 + (remainingMs / (7 * dayMs)) * 0.7);
            }
        }
        // Signal 3: Live confidence — speculative/corrected memories are less reliable
        let confidenceScore = 1.0;
        if (meta.speculative === true) {
            // Speculative memories get penalty based on confidence level
            const specLevel = meta.confidence;
            confidenceScore *= specLevel === "high" ? 0.9 : specLevel === "medium" ? 0.7 : 0.5;
        }
        if (meta.correction === true) {
            // v1.8.2 reconsolidation: corrected memories need re-verification
            confidenceScore *= 0.6;
        }
        // Signal 4: Relational importance — access frequency + memory type weight
        let relationalScore = 0.5; // baseline
        const accessCount = r.accessCount ?? 0;
        if (accessCount > 0) {
            relationalScore = Math.min(1.0, 0.3 + Math.log(1 + accessCount) * 0.15);
        }
        // Memory type bonus: preferences and entities are structurally important
        const memType = meta.memoryType;
        if (memType === "preference" || memType === "entity")
            relationalScore = Math.min(1.0, relationalScore + 0.15);
        if (memType === "goal")
            relationalScore = Math.min(1.0, relationalScore + 0.1);
        const fusedScore = w.semantic * semanticScore
            + w.temporal * temporalScore
            + w.confidence * confidenceScore
            + w.relational * relationalScore;
        return { ...r, score: fusedScore };
    });
}
/** Apply all scoring layers.
 * v1.8.2: When enableFourSignal is true, uses SmartVector four-signal fusion
 * instead of simple importance weighting. Falls back to legacy path otherwise. */
export function applyScoring(results, _userMessage, enableFourSignal, fourSignalWeights) {
    if (enableFourSignal) {
        return applyFourSignalFusion(results, fourSignalWeights);
    }
    return applyImportanceWeighting(applyLengthNormalization(results));
}
/** Filter results by access scope */
export function filterByScope(results, scopeManager, agentId) {
    if (!scopeManager || !agentId)
        return results;
    const allowed = scopeManager.getScopes(agentId);
    return results.filter((r) => !r.scope || allowed.includes(r.scope));
}
/** Stopword set for query cleaning */
const STOPWORDS = new Set([
    "可以",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
]);
/** Filter stopwords from a word array */
export function filterStopwords(words) {
    return words.filter((w) => !STOPWORDS.has(w) && w.length <= 50);
}
