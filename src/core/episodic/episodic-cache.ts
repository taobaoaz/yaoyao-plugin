/**
 * core/episodic/episodic-cache.ts — Dual Process episodic window.
 *
 * Paper: "Episodic-Semantic Memory Architecture" (arXiv:2605.17625) —
 * Dual Process: constant-size episodic window (fast, exact match) +
 * growing semantic LTM (slow, approximate).
 *
 * This module implements the fast episodic layer: a ring buffer of
 * recent conversation turns that supports exact-match and near-match
 * retrieval in O(n) where n is the window size (typically 10-20).
 *
 * Benefits: recent context is immediately available without DB queries,
 * latency for follow-up questions drops to near-zero.
 */

export interface EpisodicEntry {
  /** Unique ID (incrementing counter) */
  id: number;
  /** Session key for scoping */
  sessionKey: string;
  /** User message text */
  userText: string;
  /** Assistant response text */
  asstText: string;
  /** Timestamp (ms) */
  timestamp: number;
  /** Memory value score (from seven-factor function) */
  value?: number;
}

export interface EpisodicCacheConfig {
  /** Maximum entries in the ring buffer (default 20) */
  maxSize: number;
  /** Minimum overlap (Jaccard) for near-match (default 0.3) */
  nearMatchThreshold: number;
}

const DEFAULT_CONFIG: EpisodicCacheConfig = {
  maxSize: 20,
  nearMatchThreshold: 0.3,
};

export class EpisodicCache {
  private buffer: EpisodicEntry[] = [];
  private nextId = 0;
  private config: EpisodicCacheConfig;

  constructor(config?: Partial<EpisodicCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add a conversation turn to the episodic buffer. */
  push(entry: Omit<EpisodicEntry, "id">): void {
    const full: EpisodicEntry = { ...entry, id: this.nextId++ };
    this.buffer.push(full);
    // Ring buffer: trim oldest entries beyond maxSize
    if (this.buffer.length > this.config.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Query the episodic buffer for relevant recent context.
   * Returns entries that match by exact keyword overlap or near-match.
   *
   * Strategy:
   * 1. Exact substring match → highest priority
   * 2. Token overlap (Jaccard) ≥ nearMatchThreshold → secondary
   * 3. Results sorted by recency (newest first)
   *
   * Returns empty if no matches — caller falls through to LTM.
   */
  query(
    userQuery: string,
    sessionKey?: string,
    maxResults: number = 3,
  ): EpisodicEntry[] {
    if (this.buffer.length === 0) return [];

    const queryTokens = new Set(
      userQuery.toLowerCase().split(/[\s\p{P}]+/u).filter(t => t.length >= 2),
    );
    if (queryTokens.size === 0) return [];

    const scored: Array<{ entry: EpisodicEntry; score: number }> = [];

    for (const entry of this.buffer) {
      // Scope by session if specified
      if (sessionKey && entry.sessionKey !== sessionKey) continue;

      const combined = `${entry.userText} ${entry.asstText}`.toLowerCase();

      // Exact substring match → score 1.0
      let score = 0;
      if (combined.includes(userQuery.toLowerCase().trim())) {
        score = 1.0;
      } else {
        // Token overlap (Jaccard)
        const entryTokens = new Set(combined.split(/[\s\p{P}]+/u).filter(t => t.length >= 2));
        const intersection = [...queryTokens].filter(t => entryTokens.has(t)).length;
        const union = new Set([...queryTokens, ...entryTokens]).size;
        const jaccard = intersection / union;
        if (jaccard >= this.config.nearMatchThreshold) {
          score = jaccard;
        }
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    // Sort by score, then by recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.timestamp - a.entry.timestamp;
    });

    return scored.slice(0, maxResults).map(s => s.entry);
  }

  /** Get all entries (for debugging/stats) */
  getAll(): EpisodicEntry[] {
    return [...this.buffer];
  }

  /** Clear the buffer */
  clear(): void {
    this.buffer = [];
  }

  /** Current buffer size */
  get size(): number {
    return this.buffer.length;
  }
}
/** v1.8.2: Global singleton for cross-module sharing (capture → recall) */
let globalCache: EpisodicCache | null = null;

export function getGlobalEpisodicCache(): EpisodicCache {
  if (!globalCache) {
    globalCache = new EpisodicCache();
  }
  return globalCache;
}
