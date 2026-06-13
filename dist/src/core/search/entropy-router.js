/**
 * core/search/entropy-router.ts — Adaptive granularity router.
 *
 * Based on MemGAS (arXiv:2505.19549) entropy-based router concept:
 * Dynamically adjusts search parameters (maxResults, minScore) based on
 * query entropy — the specificity/vagueness of the user's question.
 *
 * Low entropy → narrow search (small K, high threshold)
 * High entropy → broad search (large K, low threshold)
 */
// ── Pattern sets ──
/** Terms that indicate a broad/vague search */
const BROAD_PATTERNS = [
    /全部|所有|一切|任何|每个|各种|各式|各类|多样|汇总|总结|概述|概览|回顾|一览|看看|有什么|有哪些|找找|搜一下|查一下/iu,
    /all|every|any|each|everything|overview|summary|list|list out|show me|find|search|lookup/iu,
];
/** Terms that indicate high precision */
const PRECISION_PATTERNS = [
    /^['"「『].+['"」』]$/, // quoted (exact match)
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/, // dates
    /\b\d+(?:\.\d+)?(?:%|元|kg|km|cm|mm|px|s|ms|min|h|小时|分钟|秒|天|月|年)\b/, // numbers with units
    /v\d+(?:\.\d+)+/, // version numbers
    /\b[a-f0-9]{7,40}\b/i, // hash-like
];
/** Named entity indicators */
const ENTITY_PATTERNS = [
    /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/, // proper nouns like "OpenAI ChatGPT"
    /@\w+|#\w+/, // social handles
    /[A-Z]{2,}/, // acronyms like API, K8s
    /\b[A-Z][a-z]*[A-Z][a-zA-Z]*\b/, // CamelCase identifiers
];
const DEFAULT_CONFIG = {
    baseMax: 10,
    baseMinScore: 0.3,
    maxBroadMultiplier: 2.0,
    minNarrowMultiplier: 0.5,
};
// ── Core entropy calculation ──
function countMatches(text, patterns) {
    let count = 0;
    for (const p of patterns) {
        const m = text.match(p);
        if (m)
            count += m.length;
    }
    return count;
}
/**
 * Calculate the entropy of a query string.
 *
 * Factors considered:
 * 1. Query length (normalised): shorter → more vague → higher entropy
 * 2. Entity count: more entities → more specific → lower entropy
 * 3. Precision terms: dates, units, quotes → lower entropy
 * 4. Broad terms: "list all", "find", "overview" → higher entropy
 * 5. Intent ambiguity: more matching patterns → higher entropy
 */
export function calculateEntropy(query, intent) {
    if (!query || query.trim().length === 0) {
        return emptyProfile();
    }
    const trimmed = query.trim();
    // Factor 1: Query length (15-60 chars is "normal", below 15 is vague, above 100 is specific)
    const lenFactor = Math.max(0, Math.min(1, 1 - (trimmed.length - 5) / 100));
    // Factor 2: Entity count
    const entityCount = countMatches(trimmed, ENTITY_PATTERNS);
    const entityFactor = Math.min(1, entityCount / 3); // 0-1, 3+ entities = max specificity
    // Factor 3: Precision terms
    const precisionCount = countMatches(trimmed, PRECISION_PATTERNS);
    const precisionFactor = Math.min(1, precisionCount / 3);
    // Factor 4: Broad terms
    const broadCount = countMatches(trimmed, BROAD_PATTERNS);
    const broadFactor = Math.min(1, broadCount / 2);
    // Factor 5: Intent ambiguity (more patterns means less clear intent)
    const patternFamilies = [
        /^[什么是啥何]/,
        /怎么|如何/,
        /为什么|原因/,
        /区别|对比|哪个/,
        /找|查|搜/,
    ];
    const intentMatches = patternFamilies.filter((p) => p.test(trimmed)).length;
    const ambiguityFactor = Math.min(1, intentMatches / 3);
    // Weighted entropy: precision & entities reduce it, broad terms & ambiguity increase it
    const entropy = lenFactor * 0.25 +
        (1 - entityFactor) * 0.25 +
        (1 - precisionFactor) * 0.2 +
        broadFactor * 0.15 +
        ambiguityFactor * 0.15;
    const clampedEntropy = Math.max(0, Math.min(1, entropy));
    // Adjusted parameters: low entropy → narrow search, high entropy → broad search
    const cfg = DEFAULT_CONFIG;
    const range = cfg.maxBroadMultiplier - cfg.minNarrowMultiplier;
    // maxResults: low entropy → multiplier ≈ 0.5 (small), high entropy → ≈ 2.0 (large)
    const multiplier = cfg.minNarrowMultiplier + range * clampedEntropy;
    const adjMax = Math.round(cfg.baseMax * multiplier);
    // minScore: low entropy → higher threshold (precise match needed)
    //           high entropy → lower threshold (cast wider net)
    const adjMinScore = Math.round(cfg.baseMinScore * (1.5 - clampedEntropy * 0.75) * 100) / 100;
    return {
        entropy: Math.round(clampedEntropy * 100) / 100,
        adjustedMaxResults: adjMax,
        adjustedMinScore: adjMinScore,
        factors: {
            queryLength: Math.round(lenFactor * 100) / 100,
            entityCount,
            precisionTerms: precisionCount,
            broadTerms: broadCount,
            intentAmbiguity: Math.round(ambiguityFactor * 100) / 100,
        },
        intent: intent ?? 'general',
    };
}
function emptyProfile() {
    return {
        entropy: 1,
        adjustedMaxResults: DEFAULT_CONFIG.baseMax,
        adjustedMinScore: DEFAULT_CONFIG.baseMinScore,
        factors: {
            queryLength: 0,
            entityCount: 0,
            precisionTerms: 0,
            broadTerms: 0,
            intentAmbiguity: 0,
        },
        intent: 'general',
    };
}
/**
 * Quick check: is this query worth caching?
 * Only cache queries with entropy < 0.6 (reasonably specific).
 * Vague queries tend to produce new results each time.
 */
export function isCacheable(profile) {
    return profile.entropy < 0.6;
}
