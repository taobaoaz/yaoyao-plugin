/**
 * core/search/pipeline-types.ts — Search pipeline type definitions.
 */
import type { SearchResult, EmbeddedSearchResult } from "../../storage/bridge.ts";
import type { IntentWeights, QueryIntent } from "./intent.ts";

export type SearchStrategy =
  | "fts"
  | "hybrid"
  | "rrf"
  | "multi-signal"
  | "additive"
  | "intent-driven";

export interface SearchPipelineOptions {
  strategy?: SearchStrategy;
  limit?: number;
  rrfK?: number;
  temporalDecayDays?: number;
  entityBoost?: boolean;
  intentWeights?: Partial<IntentWeights>;
}

export interface SearchContext {
  intent: QueryIntent;
  weights: IntentWeights;
  effectiveStrategy: SearchStrategy;
}

export interface ScoredSearchResult {
  result: SearchResult | EmbeddedSearchResult;
  compositeScore: number;
  signals: {
    fts: number;
    vector: number;
    temporal: number;
  };
  memoryType?: string;
}
