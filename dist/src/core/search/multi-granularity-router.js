/**
 * core/search/multi-granularity-router.ts — L0/L1/L2 entropy router.
 *
 * Extends the base entropy router with a 3-tier granularity layer system
 * inspired by MemGAS (arXiv:2505.19549) multi-granularity memory architecture.
 *
 * Layers (assigned by entropy):
 *   L0 — Quick recall      (entropy < 0.3) — short TTL, narrow search
 *   L1 — Balanced recall   (0.3 ≤ entropy < 0.7) — medium TTL, mid search
 *   L2 — Broad exploration (entropy ≥ 0.7) — long TTL, wide search + cluster expansion
 *
 * Why three layers (not one):
 *   - L0: 60% of queries are "find me X" style — fast, cacheable, narrow
 *   - L1: 30% are "show me stuff about Y" — medium cost, broader
 *   - L2: 10% are "explore / list / overview" — heavy, cluster-expanded
 *
 * Each layer can override:
 *   - maxResults
 *   - minScore
 *   - ttlMs
 *   - includeVector
 *   - includeClusterExpansion (L2 only by default)
 *   - cacheable
 */
import { calculateEntropy } from "./entropy-router.js";
const DEFAULT_LAYER_CONFIG = {
    L0: { maxResults: 5, minScore: 0.55, ttlMs: 60_000, includeVector: false },
    L1: { maxResults: 10, minScore: 0.4, ttlMs: 5 * 60_000, includeVector: true },
    L2: { maxResults: 20, minScore: 0.25, ttlMs: 30 * 60_000, includeVector: true, includeClusterExpansion: true },
};
const L0_THRESHOLD = 0.3;
const L2_THRESHOLD = 0.7;
/** Pick a granularity layer for a given entropy score. */
export function pickLayer(entropy) {
    if (entropy < L0_THRESHOLD)
        return 'L0';
    if (entropy < L2_THRESHOLD)
        return 'L1';
    return 'L2';
}
/**
 * Build a layer profile for a query.
 *
 * @param query     — raw user query
 * @param intent    — optional pre-classified intent
 * @param config    — optional layer overrides
 * @returns         — profile + layer decision + base entropy profile
 */
export function routeByEntropy(query, intent, config = DEFAULT_LAYER_CONFIG) {
    const entropy = calculateEntropy(query, intent);
    const layer = pickLayer(entropy.entropy);
    const cfg = config[layer];
    const profile = {
        layer,
        maxResults: cfg.maxResults,
        minScore: cfg.minScore,
        ttlMs: cfg.ttlMs,
        includeVector: cfg.includeVector,
        includeClusterExpansion: layer === 'L2'
            ? (config.L2.includeClusterExpansion ?? true)
            : false,
        cacheable: layer !== 'L2', // L2 broad explorations are less cacheable
        rationale: `entropy=${entropy.entropy.toFixed(2)} → ${layer}`,
    };
    return { layer, profile, entropy };
}
/** Get the default layer config (for inspection / tests). */
export function getDefaultLayerConfig() {
    return DEFAULT_LAYER_CONFIG;
}
/** Get threshold constants (for tests). */
export function getLayerThresholds() {
    return { L0: L0_THRESHOLD, L2: L2_THRESHOLD };
}
