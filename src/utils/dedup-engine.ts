/**
 * utils/dedup-engine.ts — Three-stage dedup engine.
 *
 * Inspired by local memory approach's approach: L1 exact hash → L2 vector cosine → L3 text fallback.
 * Replaces the simple batch-dedup with a progressive pipeline.
 *
 * v1.8.0
 */
import type { DBBridge } from "./db-bridge.ts";
import type { EmbeddingService } from "./embedding.ts";
import { SimpleLRU } from "./simple-lru.ts";
import { isDuplicateOfRecent, textSimilarity } from "./batch-dedup.ts";
import { cosineSimilarity } from "../core/search/enhanced.ts";

// ── Types ──

export interface DedupResult {
  isDuplicate: boolean;
  stage: "hash" | "vector" | "text" | "none";
  /** Confidence 0-1 */
  confidence: number;
  /** Human-readable reason */
  reason: string;
  /** v1.8.1 (RecMem): Semantic recurrence signal.
   *  true when content is semantically similar to prior capture but NOT a duplicate
   *  (similarity in [recurrenceLo, vectorThreshold) band).
   *  Paper: RecMem (arXiv:2605.16045) — accumulate-then-extract: only run LLM
   *  extraction when semantic recurrence is observed. */
  recurrence?: boolean;
  /** v1.8.1 (RecMem): How many times this semantic cluster has recurred (1-indexed). */
  recurrenceCount?: number;
}

export interface DedupOptions {
  enabled: boolean;
  /** L1: in-memory hash LRU size */
  hashLruSize: number;
  /** L2: vector cosine similarity threshold (0-1) */
  vectorThreshold: number;
  /** L2: number of top candidates to compare */
  vectorTopN: number;
  /** L3: text similarity threshold (0-1) */
  textThreshold: number;
  /** How many recent memories to check for L3 */
  textLookback: number;
  /** v1.8.1 (RecMem): Lower bound for semantic recurrence band [recurrenceLo, vectorThreshold).
   *  Similarity in this band = recurrence (not dedup, but semantically related).
   *  Paper: RecMem (arXiv:2605.16045). Default 0.60. */
  recurrenceLo: number;
}

const DEFAULT_OPTIONS: DedupOptions = {
  enabled: true,
  hashLruSize: 500,
  vectorThreshold: 0.80,
  vectorTopN: 5,
  textThreshold: 0.85,
  textLookback: 10,
  recurrenceLo: 0.60,
};

// ── L1: In-memory content hash LRU ──

function contentHash(text: string, owner?: string): string {
  let hash = 0;
  const data = `${owner || "default"}:${text}`;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `${owner || "default"}:${hash}`;
}

// ── Main engine ──

export class DedupEngine {
  private hashCache: SimpleLRU<string, boolean>;
  /** v1.8.1 (RecMem): Semantic recurrence tracker — maps content hash → recurrence count */
  private recurrenceCache: SimpleLRU<string, number>;
  private opts: DedupOptions;

  constructor(opts?: Partial<DedupOptions>) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.hashCache = new SimpleLRU<string, boolean>({ maxSize: this.opts.hashLruSize });
    this.recurrenceCache = new SimpleLRU<string, number>({ maxSize: this.opts.hashLruSize });
  }

  /** Run all three stages in order. Returns as soon as any stage finds a match. */
  async check(
    text: string,
    db: DBBridge,
    embedding?: EmbeddingService | null,
    owner?: string,
  ): Promise<DedupResult> {
    if (!this.opts.enabled) {
      return { isDuplicate: false, stage: "none", confidence: 0, reason: "dedup disabled" };
    }

    // ── L1: Exact content hash ──
    const hash = contentHash(text, owner);
    if (this.hashCache.get(hash)) {
      // Record in LRU so it stays hot
      this.hashCache.set(hash, true);
      return { isDuplicate: true, stage: "hash", confidence: 1.0, reason: "exact content hash match" };
    }

    // ── L2: Vector cosine similarity (with RecMem recurrence detection) ──
    let recurrenceDetected = false;
    let recurrenceCount = 0;
    if (embedding?.isAvailable) {
      try {
        const queryVec = await embedding.embed(text, 30000);
        if (queryVec && queryVec.length > 0) {
          const vecResults = db.vectorSearch(queryVec, this.opts.vectorTopN);
          let maxSim = 0;
          for (const vr of vecResults) {
            const sim = typeof vr.vectorScore === "number" ? vr.vectorScore : 0;
            if (sim > maxSim) maxSim = sim;
            if (sim >= this.opts.vectorThreshold) {
              this.hashCache.set(hash, true);
              return {
                isDuplicate: true,
                stage: "vector",
                confidence: sim,
                reason: `vector similarity ${sim.toFixed(3)} >= ${this.opts.vectorThreshold}`,
              };
            }
          }
          // v1.8.1 (RecMem): Check semantic recurrence band [recurrenceLo, vectorThreshold)
          if (maxSim >= this.opts.recurrenceLo) {
            const prevCount = this.recurrenceCache.get(hash) ?? 0;
            recurrenceCount = prevCount + 1;
            this.recurrenceCache.set(hash, recurrenceCount);
            recurrenceDetected = true;
          }
        }
      } catch (err) {
        console.debug?.(`[yaoyao-memory:dedup] L2 vector check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── L3: Text similarity (trigram Jaccard + Levenshtein) ──
    try {
      const recent = db.getLatestMemory(this.opts.textLookback);
      const dup = isDuplicateOfRecent(text, recent, this.opts.textThreshold);
      if (dup) {
        this.hashCache.set(hash, true);
        return {
          isDuplicate: true,
          stage: "text",
          confidence: this.opts.textThreshold,
          reason: `text similarity >= ${this.opts.textThreshold}`,
        };
      }
    } catch (err) {
      console.debug?.(`[yaoyao-memory:dedup] L3 text check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Not a duplicate — record the hash so future exact repeats are caught
    this.hashCache.set(hash, true);
    return {
      isDuplicate: false,
      stage: "none",
      confidence: 0,
      reason: "unique content",
      ...(recurrenceDetected ? { recurrence: true, recurrenceCount } : {}),
    };
  }

  /** Get current hash cache size (for stats/debugging) */
  get hashCacheSize(): number {
    return this.hashCache.size;
  }

  /** v1.8.1 (RecMem): Get current recurrence tracker size */
  get recurrenceCacheSize(): number {
    return this.recurrenceCache.size;
  }
}
