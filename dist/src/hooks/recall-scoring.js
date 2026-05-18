/** Jaccard similarity between two strings (word-based) */
export function jaccard(a, b) {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}
/** Diversity sampling: keep results that differ from each other */
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
/** Apply time decay (weibull exponential or logistic) */
export function applyTimeDecay(results, halfLifeDays, mode) {
    const now = Date.now();
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    return results.map((r) => {
        const ageMs = now - (r.timestamp || now);
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
/** Apply all scoring layers */
export function applyScoring(results, _userMessage) {
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
