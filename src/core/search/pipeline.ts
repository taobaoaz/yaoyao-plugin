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

export type SearchStrategy =
  | "fts"           // Pure FTS5 (fastest)
  | "hybrid"        // FTS5 + vector weighted
  | "rrf"           // FTS5 + vector RRF fusion
  | "multi-signal"  // FTS5 + BM25 + vector + entity boost
  | "additive"      // mem0 v3 style additive scoring
  | "intent-driven";// Auto-classify query, use intent-aware weights

export interface SearchPipelineOptions {
  strategy?: SearchStrategy;
  limit?: number;
  rrfK?: number;
  temporalDecayDays?: number;
  entityBoost?: boolean;
  /**
   * Intent-aware weights override.
   * When set, overrides the auto-classified intent weights.
   * Only used with strategy="intent-driven" or strategy="rrf".
   */
  intentWeights?: Partial<IntentWeights>;
}

/** Context object returned alongside results to enable downstream analysis */
export interface SearchContext {
  /** Classified query intent */
  intent: QueryIntent;
  /** Actual weights applied in this search */
  weights: IntentWeights;
  /** Strategy that was actually executed */
  effectiveStrategy: SearchStrategy;
}

/** Extended search result with per-signal breakdown */
export interface ScoredSearchResult {
  result: SearchResult | EmbeddedSearchResult;
  /** Intent-weighted composite score (normalized 0-1) */
  compositeScore: number;
  /** Individual signal scores */
  signals: {
    fts: number;
    vector: number;
    temporal: number;
  };
  /** Which memory type this likely belongs to (if tagged) */
  memoryType?: string;
}

/**
 * Apply intent-aware weights to produce a composite score.
 * Normalizes all scores into a single 0-1 value.
 */
function applyIntentWeights(
  result: SearchResult | EmbeddedSearchResult,
  weights: IntentWeights,
): { compositeScore: number; signals: { fts: number; vector: number; temporal: number } } {
  // FTS score: higher = better, typically 0-1 range
  const ftsScore = typeof (result as SearchResult).score === "number"
    ? (result as SearchResult).score
    : 0.3;

  // Vector score: if EmbeddedSearchResult, use vectorScore or hybridScore
  const vecResult = result as EmbeddedSearchResult;
  const vectorScore = typeof vecResult.vectorScore === "number"
    ? vecResult.vectorScore
    : typeof vecResult.hybridScore === "number"
      ? vecResult.hybridScore
      : ftsScore; // fallback when vector unavailable

  // Temporal recency: check if EmbeddedSearchResult has timestamp
  const timestamp = "timestamp" in result ? (result as unknown as { timestamp?: number }).timestamp : undefined;
  const temporalScore = typeof timestamp === "number" && Number.isFinite(timestamp)
    ? temporalDecay(timestamp, 30) // 30-day half-life
    : 0.5; // neutral if no timestamp

  // Composite: weighted sum
  const compositeScore = (
    weights.fts * ftsScore +
    weights.vector * vectorScore +
    weights.temporal * temporalScore
  );

  return {
    compositeScore: Math.min(1, Math.max(0, compositeScore)),
    signals: { fts: ftsScore, vector: vectorScore, temporal: temporalScore },
  };
}

/** Exponential temporal decay: max score for today, half after `halfLifeDays` */
function temporalDecay(timestampMs: number, halfLifeDays: number): number {
  const ageMs = Date.now() - timestampMs;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 0) return 1.0;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Unified search pipeline with intent-aware scoring.
 *
 * Inspired by Cortex Memory's layered retrieval:
 *   score = w_fts × FTS_score + w_vec × vector_score + w_temp × temporal_score
 * where weights are determined by classified query intent.
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
          // Classify intent & pick weights
          const intent = classifyIntent(query);
          const weights: IntentWeights = options.intentWeights
            ? { ...INTENT_WEIGHTS[intent], ...options.intentWeights }
            : INTENT_WEIGHTS[intent];

          // Fetch raw results (overfetch)
          let results: (SearchResult | EmbeddedSearchResult)[];
          if (hasEmbedding && embedding) {
            const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
            results = await storage.rrfHybridSearch(query, queryVec, overfetchLimit, options.rrfK ?? 60);
          } else {
            results = storage.search(query, overfetchLimit);
          }

          // Re-rank by intent-weighted composite score
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

    /**
     * Get intent classification + weights without executing the search.
     * Useful for downstream components that want to log or display intent analysis.
     */
    analyzeQuery(query: string): { intent: QueryIntent; weights: IntentWeights } {
      const intent = classifyIntent(query);
      return { intent, weights: INTENT_WEIGHTS[intent] };
    },
  };
}

export type SearchPipeline = ReturnType<typeof createSearchPipeline>;

/** Re-export INTENT_WEIGHTS for direct use by downstream code */
export { INTENT_WEIGHTS } from "./intent.ts";
export { classifyIntent } from "./intent.ts";

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
