/**
 * features/multi-signal/formatter.ts — Multi-signal search output formatting.
 *
 * Pure formatting functions for text and json output.
 */
import type { SearchResult } from "../../storage/types.ts";
import { formatMultiSignalResults } from "../../core/search/multi-signal.ts";
import { formatAdditiveResults } from "../../core/search/additive-scorer.ts";
import type { AdditiveScoreResult } from "../../core/search/additive-scorer.ts";
import type { MultiSignalResult } from "../../core/search/signal-fusion.ts";

export function mergeAndDedupResults(fts: SearchResult[], vec: SearchResult[]): SearchResult[] {
  const seen = new Set<number | string>();
  const merged: SearchResult[] = [];

  for (const r of fts) {
    const key = r.id ?? r.snippet;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }

  for (const r of vec) {
    const id = typeof r.id === "number" ? r.id : undefined;
    const snippet = typeof r.snippet === "string" ? r.snippet : "";
    const key = id ?? snippet;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id,
      filename: typeof r.filename === "string" ? r.filename : "",
      snippet,
      score: typeof r.score === "number" ? r.score : 0.5,
      date: typeof r.date === "string" ? r.date : "",
    });
  }

  return merged;
}

export interface FormattedResult {
  id: number | string;
  snippet: string;
  date: string;
  score: number;
  signals?: Record<string, unknown>;
  source?: string;
  filename?: string;
}

export function formatJsonResults(
  query: string,
  topResults: FormattedResult[],
  allResultsCount: number,
  fusionMode: string,
): string {
  return JSON.stringify({
    query,
    count: topResults.length,
    totalCandidates: allResultsCount,
    fusionMode,
    results: topResults.map((r: FormattedResult) => ({
      id: r.id,
      snippet: (String(r.snippet ?? "")).slice(0, 200),
      date: r.date,
      score: r.score,
      signals: r.signals,
      source: r.source,
    })),
  }, null, 2);
}

export function formatTextResults(
  topResults: FormattedResult[],
  query: string,
  fusionMode: "rrf" | "additive",
  allResultsCount: number,
): string {
  const text: string = fusionMode === "additive"
    ? formatAdditiveResults(topResults as unknown as AdditiveScoreResult[], query)
    : formatMultiSignalResults(topResults as unknown as MultiSignalResult[], query);

  return text + `\nFusion mode: ${fusionMode === "additive" ? "Additive Scoring" : "RRF"} | ${allResultsCount} candidates merged to ${topResults.length} results.`;
}
