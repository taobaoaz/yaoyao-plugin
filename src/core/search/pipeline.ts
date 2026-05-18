/**
 * core/search/pipeline.ts — Unified search pipeline.
 *
 * Provides a single entry point for all search strategies:
 *   - pure FTS5 (via storage/fts.ts)
 *   - hybrid (FTS5 + vector, RRF or weighted)
 *   - multi-signal (FTS5 + BM25 + vector + entity boost)
 *
 * Tool layers only need to call pipeline.search() and select strategy.
 * No direct SQL access required outside the storage layer.
 */
import type { Storage, SearchResult, EmbeddedSearchResult } from "../../storage/bridge.ts";
import type { EmbeddingService } from "../../utils/embedding.ts";
import { multiSignalFusion } from "./multi-signal.ts";

export type SearchStrategy =
  | "fts"           // Pure FTS5 (fastest)
  | "hybrid"        // FTS5 + vector weighted
  | "rrf"           // FTS5 + vector RRF fusion
  | "multi-signal"  // FTS5 + BM25 + vector + entity boost
  | "additive";     // mem0 v3 style additive scoring

export interface SearchPipelineOptions {
  strategy?: SearchStrategy;
  limit?: number;
  rrfK?: number;
  temporalDecayDays?: number;
  entityBoost?: boolean;
}

/**
 * Unified search pipeline. Each search() call can use a different strategy.
 * No internal state — safe to reuse across requests.
 */
export function createSearchPipeline(
  storage: Storage,
  embedding?: EmbeddingService | null,
) {
  const hasEmbedding = !!embedding;

  return {
    async search(
      query: string,
      options: SearchPipelineOptions = {},
    ): Promise<(SearchResult | EmbeddedSearchResult)[]> {
      const strategy = options.strategy ?? "rrf";
      const limit = options.limit ?? 10;
      const overfetchLimit = limit * 2;

      switch (strategy) {
        case "fts":
          return storage.search(query, limit);

        case "hybrid": {
          if (!hasEmbedding || !embedding) return storage.search(query, limit);
          const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
          return storage.hybridSearch(query, queryVec, limit);
        }

        case "rrf": {
          if (!hasEmbedding || !embedding) return storage.search(query, limit);
          const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
          return storage.rrfHybridSearch(query, queryVec, limit, options.rrfK ?? 60);
        }

        case "multi-signal": {
          const ftsResults = storage.search(query, overfetchLimit);
          let vecResults: ReturnType<Storage["vectorSearch"]> = [];
          if (hasEmbedding && embedding) {
            try {
              const qv = await embedding.embed(query, embedding.recallTimeoutMs);
              vecResults = storage.vectorSearch(qv, overfetchLimit);
            } catch { /* vector unavailable */ }
          }

          const dummyVec = vecResults.map(r => ({
            ...r,
            asst_text: "",
            timestamp: undefined as number | undefined,
            importance: undefined as number | undefined,
            scope: undefined as string | undefined,
          }));

          const allResults = dedupSearchResults(ftsResults, vecResults);
          const entityBoostEnabled = options.entityBoost !== false;
          const signalConfig = {
            temporalHalfLifeDays: options.temporalDecayDays ?? 30,
            entityBoostMax: entityBoostEnabled ? 0.30 : 0,
          };

          const fused = multiSignalFusion(query, ftsResults, dummyVec, allResults, signalConfig);
          // Cast to satisfy TS union type — MultiSignalResult has more fields than SearchResult
          return fused.slice(0, limit) as unknown as (SearchResult | EmbeddedSearchResult)[];
        }

        default:
          return storage.search(query, limit);
      }
    },

    get hasEmbeddingSupport(): boolean {
      return hasEmbedding;
    },

    searchFts(query: string, limit: number = 10): SearchResult[] {
      return storage.search(query, limit);
    },
  };
}

export type SearchPipeline = ReturnType<typeof createSearchPipeline>;

function dedupSearchResults(fts: SearchResult[], vec: EmbeddedSearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of fts) {
    const key = `${r.id ?? ""}|${r.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  for (const r of vec) {
    const key = `${r.id ?? ""}|${r.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged;
}
