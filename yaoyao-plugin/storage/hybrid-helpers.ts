/**
 * storage/hybrid-helpers.ts — Hybrid search helpers for Storage.
 *
 * Encapsulates weighted and RRF hybrid search logic.
 */
import type { FtsEngine } from './fts.ts';
import type { VectorStore } from './vector-store.ts';
import type { HybridSearch } from './hybrid.ts';
import type { EmbeddedSearchResult, SearchResult } from './types.ts';

export function hybridSearch(
  db: unknown,
  query: string,
  embedding: Float32Array | null,
  limit: number,
  fts: FtsEngine,
  vector: VectorStore,
  hybrid: HybridSearch,
): EmbeddedSearchResult[] {
  const ftsResults = fts.search(db as never, query, limit);
  if (!embedding || ftsResults.length === 0) {
    return ftsResults.map((r) => ({ ...r, vectorScore: 0, hybridScore: (r.score ?? 0) * 0.6 }));
  }
  const vecResults = vector.search(embedding, limit);
  return hybrid.weighted(ftsResults, vecResults, limit);
}

export function rrfHybridSearch(
  db: unknown,
  query: string,
  embedding: Float32Array | null,
  limit: number,
  k: number,
  fts: FtsEngine,
  vector: VectorStore,
  hybrid: HybridSearch,
): EmbeddedSearchResult[] {
  const overfetchLimit = limit * 2;
  const ftsResults = fts.search(db as never, query, overfetchLimit);
  if (!embedding || ftsResults.length === 0) {
    return ftsResults.slice(0, limit).map((r) => ({ ...r, vectorScore: 0, hybridScore: r.score }));
  }
  const vecResults = vector.search(embedding, overfetchLimit);
  return hybrid.rrf(ftsResults, vecResults, limit);
}
