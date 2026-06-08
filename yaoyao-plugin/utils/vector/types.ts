/**
 * Vector backend abstraction — pluggable ANN search layer.
 *
 * Supports: sqlite-vec (default, zero-dep) and hnswlib (optional, high-performance).
 *
 * All backends share the same contract so db-bridge.ts stays clean.
 */
import type { UnifiedDB } from '../../platform/db/compat.ts';
import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';
import type { YaoyaoMemoryConfig } from '../memory-store.ts';

export interface EmbeddedSearchResult {
  id: number;
  filename: string;
  snippet: string;
  score: number; // combined or FTS score
  date: string;
  asst_text?: string;
  vectorScore: number; // pure vector similarity (0-1)
  hybridScore: number; // weighted combination
}

export interface VectorBackend {
  readonly name: string;
  readonly isAvailable: boolean;

  /** Initialize the backend. Return false if it cannot be used (graceful fallback). */
  init(db: UnifiedDB, config: YaoyaoMemoryConfig, logger?: PluginLogger): boolean;

  /** Store a vector for a memory record (metaId = rowid in memory_meta). */
  storeVector(metaId: number, embedding: Float32Array): boolean;

  /** Search nearest vectors. Returns empty array on any error. */
  vectorSearch(embedding: Float32Array, limit: number): EmbeddedSearchResult[];

  /** Release resources (memory, file handles, timers). */
  close(): void;

  /** Delete vectors whose rowid no longer exists in memory_meta. Optional. */
  deleteOrphans?(): void;

  /** Return the current number of stored vectors. Optional. */
  getVectorCount?(): number;

  /** Return the configured vector dimensions. Optional. */
  getDimensions?(): number;
}
