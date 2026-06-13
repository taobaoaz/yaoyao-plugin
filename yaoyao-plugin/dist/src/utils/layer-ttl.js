/**
 * utils/layer-ttl.ts — Per-granularity-layer TTL resolver.
 *
 * Bridges the multi-granularity router (L0/L1/L2) with the ToolCallCache:
 * each layer gets its own TTL so we don't over-cache broad queries and
 * don't under-cache quick recalls.
 *
 *   L0 (quick recall)   → 30s   (60% of queries are short-lived)
 *   L1 (balanced recall)→ 5min  (medium-lived, allows re-use within session)
 *   L2 (broad search)   → 0     (L2 is not cached by default — see multi-granularity-router)
 *
 * Why per-layer TTLs:
 *   - L0 short queries repeat often within a session; 30s is enough.
 *   - L1 results are usually valid for the duration of a multi-step
 *     workflow; 5min lets related calls reuse.
 *   - L2 broad explorations produce varied results; better to recompute.
 *
 * Why a separate module (not in multi-granularity-router):
 *   - The router is a pure function over entropy. TTL is a policy that
 *     belongs to the cache layer. Keep responsibilities separate.
 *   - Tests can stub this without touching the entropy math.
 */
const LAYER_TTLS = {
    L0: { ttlMs: 30_000, rationale: 'quick recall: short, session-local reuse' },
    L1: { ttlMs: 5 * 60_000, rationale: 'balanced recall: medium-lived workflow reuse' },
    L2: { ttlMs: 0, rationale: 'broad exploration: not cached (results vary too much)' },
};
/** Get TTL config for a given layer. */
export function getLayerTtl(layer) {
    return LAYER_TTLS[layer];
}
/**
 * Resolve the effective TTL for a layer. Returns 0 when caching is disabled
 * (callers can short-circuit `cache.set()`).
 */
export function resolveLayerTtl(layer) {
    return LAYER_TTLS[layer].ttlMs;
}
/** Should results in this layer be cached at all? */
export function isLayerCacheable(layer) {
    return LAYER_TTLS[layer].ttlMs > 0;
}
/** All layer TTLs (for inspection / debugging). Deep-copied so callers cannot mutate. */
export function getAllLayerTtls() {
    return {
        L0: { ...LAYER_TTLS.L0 },
        L1: { ...LAYER_TTLS.L1 },
        L2: { ...LAYER_TTLS.L2 },
    };
}
