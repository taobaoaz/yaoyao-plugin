/**
 * SimpleLRU — lightweight fixed-size LRU cache with optional TTL.
 *
 * Used to replace leaky global Maps in auto-recall (sessionContext / resultCache).
 */
export class SimpleLRU {
    cache = new Map();
    maxSize;
    ttlMs;
    constructor(options) {
        this.maxSize = options.maxSize;
        this.ttlMs = options.ttlMs ?? Infinity;
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        if (this.ttlMs < Infinity && Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }
        // Move to end (MRU)
        this.cache.delete(key);
        this.cache.set(key, { value: entry.value, timestamp: Date.now() });
        return entry.value;
    }
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        else if (this.cache.size >= this.maxSize) {
            // Evict LRU (first entry)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    clear() {
        this.cache.clear();
    }
    get size() {
        return this.cache.size;
    }
}
