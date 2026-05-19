/**
 * core/search/pipeline-scoring.ts — Intent-aware scoring utilities.
 */
import type { SearchResult, EmbeddedSearchResult } from "../../storage/bridge.ts";
import type { IntentWeights } from "./intent.ts";

export function applyIntentWeights(
  result: SearchResult | EmbeddedSearchResult,
  weights: IntentWeights,
): { compositeScore: number; signals: { fts: number; vector: number; temporal: number } } {
  const ftsScore = typeof (result as SearchResult).score === "number"
    ? (result as SearchResult).score
    : 0.3;

  const vecResult = result as EmbeddedSearchResult;
  const vectorScore = typeof vecResult.vectorScore === "number"
    ? vecResult.vectorScore
    : typeof vecResult.hybridScore === "number"
      ? vecResult.hybridScore
      : ftsScore;

  const timestamp = "timestamp" in result ? (result as unknown as { timestamp?: number }).timestamp : undefined;
  const temporalScore = typeof timestamp === "number" && Number.isFinite(timestamp)
    ? temporalDecay(timestamp, 30)
    : 0.5;

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

export function temporalDecay(timestampMs: number, halfLifeDays: number): number {
  const ageMs = Date.now() - timestampMs;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 0) return 1.0;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function dedupSearchResults(fts: SearchResult[], vec: EmbeddedSearchResult[]): SearchResult[] {
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
