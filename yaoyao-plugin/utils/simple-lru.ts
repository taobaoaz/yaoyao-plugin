/**
 * SimpleLRU — lightweight fixed-size LRU cache with optional TTL.
 *
 * Used to replace leaky global Maps in auto-recall (sessionContext / resultCache).
 */

export interface LRURangeOptions<K, V> {
  maxSize: number;
  ttlMs?: number;
}

export class SimpleLRU<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(options: LRURangeOptions<K, V>) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs ?? Infinity;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (this.ttlMs < Infinity && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (MRU)
    this.cache.delete(key);
    this.cache.set(key, { value: entry.value, timestamp: Date.now() });
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict LRU (first entry)
      const firstKey = this.cache.keys().next().value as K;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
