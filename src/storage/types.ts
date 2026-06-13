/**
 * storage/types.ts — Shared types for the storage layer.
 *
 * Extracted from utils/db-bridge.ts to eliminate circular deps and
 * make the storage layer self-contained.
 */

export interface SearchResult {
  id?: number;
  filename: string;
  snippet: string;
  score: number;
  date: string;
  asst_text?: string;
  metadata?: string;
  /** Memory creation timestamp (ms) */
  timestamp?: number;
  /** Importance weight (0-1) */
  importance?: number;
  /** Scope label for access control */
  scope?: string;
}

export interface EmbeddedSearchResult extends SearchResult {
  /** Cosine similarity score from vector search (0-1) */
  vectorScore: number;
  /** Hybrid score combining FTS5 rank + vector similarity */
  hybridScore: number;
}

export interface DBStats {
  totalMemories: number;
  datesSummary: Array<{ date: string; count: number }>;
  ftsEnabled: boolean;
  vecEnabled: boolean;
  totalVectors: number;
  dimensions: number;
}

/** Raw memory_meta row */
export interface MemMetaRow {
  id: number;
  date: string;
  user_text: string | null;
  asst_text: string | null;
  meta: string | null;
  access_count: number | null;
  tier: string | null;
  importance: number | null;
  created_at: string | null;
}

/** FTS5 search row */
export interface FtsRow {
  rowid: number;
  date: string;
  user_text: string;
  asst_text: string;
  snippet: string;
  rank: number;
}

/** LIKE fallback row */
export interface LikeRow {
  id: number;
  date: string;
  user_text: string | null;
  asst_text: string | null;
}
