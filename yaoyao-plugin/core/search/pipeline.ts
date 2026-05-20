/**
 * core/search/pipeline.ts — Unified search pipeline.
 *
 * Supports intent-aware dynamic scoring (based on Cortex Memory's
 * intent-weighted layered retrieval pattern).
 *
 * Strategies:
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
import { classifyIntent, INTENT_WEIGHTS, type IntentWeights, type QueryIntent } from "./intent.ts";
import type { SearchStrategy, SearchPipelineOptions } from "./pipeline-types.ts";
import { applyIntentWeights, dedupSearchResults } from "./pipeline-scoring.ts";

export type { SearchStrategy, SearchPipelineOptions } from "./pipeline-types.ts";

/**
 * Unified search pipeline with intent-aware scoring.
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

        case "intent-driven": {
          const intent = classifyIntent(query);
          const weights: IntentWeights = options.intentWeights
            ? { ...INTENT_WEIGHTS[intent], ...options.intentWeights }
            : INTENT_WEIGHTS[intent];

          let results: (SearchResult | EmbeddedSearchResult)[];
          if (hasEmbedding && embedding) {
            const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
            results = await storage.rrfHybridSearch(query, queryVec, overfetchLimit, options.rrfK ?? 60);
          } else {
            results = storage.search(query, overfetchLimit);
          }

          const scored = results.map(r => ({
            result: r,
            ...applyIntentWeights(r, weights),
          }));

          scored.sort((a, b) => b.compositeScore - a.compositeScore);
          return scored.slice(0, limit).map(s => ({
            ...s.result,
            score: s.compositeScore,
          }));
        }

        case "multi-signal": {
          const ftsResults = storage.search(query, overfetchLimit);
          let vecResults: ReturnType<Storage["vectorSearch"]> = [];
          if (hasEmbedding && embedding) {
            try {
              const qv = await embedding.embed(query, embedding.recallTimeoutMs);
              vecResults = storage.vectorSearch(qv, overfetchLimit);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              console.warn(`[yaoyao-memory:search] Vector search failed: ${msg}`);
            }
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

    analyzeQuery(query: string): { intent: QueryIntent; weights: IntentWeights } {
      const intent = classifyIntent(query);
      return { intent, weights: INTENT_WEIGHTS[intent] };
    },
  };
}

export type SearchPipeline = ReturnType<typeof createSearchPipeline>;

export { INTENT_WEIGHTS } from "./intent.ts";
export { classifyIntent } from "./intent.ts";
