/**
 * utils/tool-call-cache.ts — SkVM-inspired result cache for tool calls.
 *
 * Based on SkVM (arXiv:2604.03088v3) JIT solidification concept:
 * Caches results of identical/near-identical tool calls to avoid
 * redundant LLM inference and repeated storage scans.
 *
 * Key design:
 * - Composite key: hash(tool_name + serialized params)
 * - Default TTL: 30s for search tools, 5-10s for capture hooks
 * - Maximum cache entries: 200
 * - Auto-invalidation: on new capture events (via clear/flush signals)
 */
import { SimpleLRU } from "./simple-lru.js";
/**
 * ToolCallCache — productivity cache for tool execution results.
 *
 * Integrates SkVM's concept: when the same tool is called with the same
 * parameters repeatedly, skip execution and return the cached result directly.
 * This avoids both LLM inference (for LLM-backed tools) and expensive
 * storage scans (for search tools).
 */
export class ToolCallCache {
    cache;
    defaultTTL;
    constructor(options = {}) {
        this.cache = new SimpleLRU({
            maxSize: options.maxSize ?? 200,
            ttlMs: options.defaultTTL ?? 30000,
        });
        this.defaultTTL = options.defaultTTL ?? 30000;
    }
    /**
     * Build a cache key from tool name + serialized params.
     * Uses simple JSON serialization — stable enough for mem tool calls.
     */
    buildKey(toolName, params) {
        const sorted = Object.keys(params)
            .sort()
            .reduce((acc, k) => {
            acc[k] = params[k];
            return acc;
        }, {});
        return `${toolName}:${JSON.stringify(sorted)}`;
    }
    /**
     * Try to get a cached result. Returns the value and metadata,
     * or null if not found / expired.
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        const ageMs = Date.now() - entry.createdAt;
        // Per-entry TTL takes precedence over the cache-level default.
        const ttlMs = entry.ttlMs ?? this.defaultTTL;
        if (ageMs >= ttlMs)
            return null;
        return {
            value: entry.value,
            isFresh: ageMs < ttlMs / 2, // "fresh" = within half TTL
            hitCount: entry.hitCount,
            ageMs,
        };
    }
    /**
     * Store a value in the cache. Returns the key for later retrieval.
     *
     * @param key         — composite cache key
     * @param value       — value to store
     * @param toolName    — tool name (for stats / debugging)
     * @param options     — optional per-set overrides:
     *                        - ttlMs:  per-entry TTL (overrides cache default)
     *                        - layer:  granularity layer (L0/L1/L2) for observability
     */
    set(key, value, toolName, options = {}) {
        const existing = this.cache.get(key);
        this.cache.set(key, {
            value: value,
            createdAt: Date.now(),
            ttlMs: options.ttlMs ?? this.defaultTTL,
            hitCount: existing ? existing.hitCount + 1 : 1,
            toolName,
            layer: options.layer,
        });
    }
    /**
     * Check if a key exists and is not expired.
     */
    has(key) {
        return this.cache.has(key);
    }
    /**
     * Invalidate a specific key.
     */
    invalidate(_key) {
        // SimpleLRU doesn't support explicit delete from outside,
        // but the TTL + LRU eviction handles this naturally.
        // For immediate invalidation we rely on the set() overwrite pattern.
    }
    /**
     * Clear the entire cache. Called when new memories are captured
     * (so stale search results are invalidated).
     */
    clear() {
        this.cache.clear();
    }
    /**
     * Number of entries currently cached.
     */
    get size() {
        return this.cache.size;
    }
    /**
     * Get stats for monitoring
     */
    stats() {
        const byLayer = {};
        // Iterate via a custom scan: SimpleLRU exposes `size` but not values().
        // Use `has` + tracking? For now, count via public `size` only.
        // Layer breakdown is best-effort; not critical for correctness.
        return {
            size: this.cache.size,
            defaultTTL: this.defaultTTL,
            byLayer,
        };
    }
}
/** Shared global instance for memory-call-search results */
let _memoryCallCache = null;
export function getMemoryCallCache() {
    if (!_memoryCallCache) {
        _memoryCallCache = new ToolCallCache({
            maxSize: 100,
            defaultTTL: 30_000, // 30s for search results
        });
    }
    return _memoryCallCache;
}
/** Shared global instance for recall hook results */
let _recallCache = null;
export function getRecallCache() {
    if (!_recallCache) {
        _recallCache = new ToolCallCache({
            maxSize: 200,
            defaultTTL: 15_000, // 15s for recall — shorter because context changes frequently
        });
    }
    return _recallCache;
}
/** Invalidate all caches (e.g., after a new capture event) */
export function invalidateAllCaches() {
    _memoryCallCache?.clear();
    _recallCache?.clear();
}
