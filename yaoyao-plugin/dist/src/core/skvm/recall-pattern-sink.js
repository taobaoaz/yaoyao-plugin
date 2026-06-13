/**
 * core/skvm/recall-pattern-sink.ts — SkVM pattern detector integration for recall.
 *
 * Bridges auto-recall hook and memory-call-search into the global
 * `PatternDetector` so that repeated `(autoRecall → memoryCallSearch)` patterns
 * are detected and recorded as "solidifiable".
 *
 * What gets recorded (per recall path execution):
 *   1. `autoRecall`     — at hook entry (with query prefix digest)
 *   2. `parallelRecall` — when parallel search executes
 *   3. `memoryCallSearch` — when memory call search executes
 *   4. `cacheHit` (skip) — when global cache short-circuits
 *
 * What this enables:
 *   - Hit rate metrics across recall+search workflow
 *   - When a workflow becomes stable (≥ 3 occurrences), the detector flags
 *     the pattern. Future calls can consult `matchTail()` to detect
 *     "we're about to do a known-stable workflow" and pre-warm caches.
 *
 * Why a sink (not direct calls):
 *   - Centralized place to record + format.
 *   - Easy to disable (call `setEnabled(false)`) without touching callers.
 *   - Lazy singleton — no overhead when disabled.
 */
import { getDefaultDetector } from "./pattern-solidifier.js";
let enabled = false;
let detectorOverride = null;
/** Enable pattern detection globally. */
export function enablePatternDetection(detector) {
    enabled = true;
    if (detector)
        detectorOverride = detector;
}
/** Disable pattern detection globally. */
export function disablePatternDetection() {
    enabled = false;
    detectorOverride = null;
}
/** Whether pattern detection is currently enabled. */
export function isPatternDetectionEnabled() {
    return enabled;
}
function getDetector() {
    return detectorOverride ?? getDefaultDetector();
}
/** Record an auto-recall hook invocation. Safe to call when disabled. */
export function recordAutoRecall(params) {
    if (!enabled)
        return;
    getDetector().record({
        tool: 'autoRecall',
        params: { q: params.queryDigest, n: params.maxResults },
        ts: params.ts,
    });
}
/** Record a parallel recall execution. */
export function recordParallelRecall(params) {
    if (!enabled)
        return;
    getDetector().record({
        tool: 'parallelRecall',
        params: { q: params.queryDigest, mode: params.mode },
        ts: params.ts,
    });
}
/** Record a memory-call-search execution. */
export function recordMemoryCallSearch(params) {
    if (!enabled)
        return;
    getDetector().record({
        tool: 'memoryCallSearch',
        params: { q: params.queryDigest, n: params.maxResults },
        ts: params.ts,
    });
}
/** Record a cache hit (records an explicit "cacheHit" event in the stream). */
export function recordRecallCacheHit(params) {
    if (!enabled)
        return;
    getDetector().record({
        tool: 'cacheHit',
        params: { q: params.queryDigest, layer: params.layer },
        ts: params.ts,
    });
}
/**
 * Get the current detector for inspection (read-only stats).
 * Useful for log/metric surfaces.
 */
export function getRecallStats() {
    return getDetector().stats();
}
/**
 * Quick hash for query prefix digest (avoids storing full query text in patterns).
 * Mirrors entropy-router's simpleHash for consistency.
 */
export function digestQuery(query) {
    let h = 2166136261 >>> 0;
    const slice = query.slice(0, 32);
    for (let i = 0; i < slice.length; i++) {
        h ^= slice.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    // hex8
    return (h >>> 0).toString(16).padStart(8, '0');
}
/** Test helper. */
export function _resetPatternSinkForTests() {
    enabled = false;
    detectorOverride = null;
}
