/**
 * storage/hybrid.ts — Hybrid search: fuses FTS5 + vector via RRF or additive.
 *
 * Extracted from db-bridge.ts (hybridSearch + rrfHybridSearch).
 */
import type { SearchResult, EmbeddedSearchResult } from "./types.ts";
import type { FtsEngine } from "./fts.ts";
import type { VectorStore } from "./vector-store.ts";
import { reciprocalRankFusion, type RankedDoc } from "../core/search/rrf.ts";

export interface HybridConfig {
  rrfK: number;
  overfetchMultiplier: number;
}

const DEFAULT_HYBRID: HybridConfig = {
  rrfK: 60,
  overfetchMultiplier: 2,
};

export function createHybridSearch(config?: Partial<HybridConfig>) : unknown: unknown {
  const cfg = { ...DEFAULT_HYBRID, ...config };

  return {
    /**
     * Weighted combination hybrid: FTS5 score * 0.6 + vector * 0.4.
     * Used when RRF is not desired.
     */
    weighted(ftsResults: SearchResult[], vecResults: EmbeddedSearchResult[], limit: number): EmbeddedSearchResult[] {
      if (ftsResults.length === 0 && vecResults.length === 0) return [];

      const merged = new Map<string, EmbeddedSearchResult>();

      for (const r of ftsResults) {
        merged.set(`${r.date}|${r.snippet}|${r.id}`, {
          ...r,
          vectorScore: 0,
          hybridScore: (r.score ?? 0) * 0.6,
        });
      }

      for (const r of vecResults) {
        const key = `${r.date}|${r.snippet}|${r.id}`;
        if (merged.has(key)) {
          const existing = merged.get(key)!;
          existing.vectorScore = r.vectorScore;
          existing.hybridScore = (existing.score * 0.6) + (r.vectorScore * 0.4);
        } else {
          merged.set(key, {
            ...r,
            score: r.vectorScore * 0.4,
            hybridScore: r.vectorScore * 0.4,
          });
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, limit);
    },

    /**
     * RRF (Reciprocal Rank Fusion) hybrid search.
     * Fuses FTS5 and vector rankings independently, then combines via 1/(k+rank).
     */
    rrf(
      ftsResults: SearchResult[],
      vecResults: EmbeddedSearchResult[],
      limit: number,
    ): EmbeddedSearchResult[] {
      if (ftsResults.length === 0 && vecResults.length === 0) return [];

      const ftsRanked: RankedDoc[] = ftsResults.map((r, i) => ({
        id: `${r.date}|${r.snippet}|${r.id || i}`,
        doc: { ...r, source: "fts" as const },
        originalScore: r.score,
      }));

      const vecRanked: RankedDoc[] = vecResults.map((r, i) => ({
        id: `${r.date}|${r.snippet}|${r.id || i}`,
        doc: { ...r, source: "vec" as const },
        originalScore: r.vectorScore,
      }));

      const fused = reciprocalRankFusion([ftsRanked, vecRanked], cfg.rrfK);

      const results: EmbeddedSearchResult[] = [];
      for (const f of fused.slice(0, limit)) {
        const doc = f.doc as Record<string, unknown>;
        results.push({
          id: doc.id as number,
          filename: String(doc.filename || ""),
          snippet: String(doc.snippet || ""),
          score: Number(doc.originalScore || 0),
          date: String(doc.date || ""),
          vectorScore: f.ranks[1] >= 0 ? Number(doc.originalScore || 0) : 0,
          hybridScore: f.rrfScore,
        });
      }

      return results;
    },
  };
}

export type HybridSearch = ReturnType<typeof createHybridSearch>;
