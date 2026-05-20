/**
 * hooks/recall-search.ts — Recall search execution.
 *
 * Encapsulates intent-driven, hybrid, and pure FTS search paths.
 */
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import type { EmbeddingService } from "../utils/embedding.ts";
import { classifyIntent } from "../core/search/intent.ts";

export interface RecallSearchConfig {
  enableIntentDriven: boolean;
  maxResults: number;
}

export async function doRecallSearch(
  db: DBBridge,
  query: string,
  cfg: RecallSearchConfig,
  embedding: EmbeddingService | null | undefined,
  logger: { warn?: (msg: string) => void },
): Promise<{ results: SearchResult[]; mode: string }> {
  let results: SearchResult[] = [];
  let mode = "fts";

  if (cfg.enableIntentDriven && embedding?.isAvailable) {
    mode = "intent-driven";
    const overfetchLimit = cfg.maxResults * 4;
    try {
      const queryVec = await embedding.embed(query);
      const vectorResults = db.vectorSearch(queryVec, overfetchLimit);
      if (vectorResults && vectorResults.length > 0) {
        results = vectorResults.map(r => ({
          ...r,
          score: r.vectorScore ?? r.score ?? 0.5,
        }));
      }
      const ftsResults = db.search(query, overfetchLimit);
      for (const f of ftsResults) {
        const exists = results.some(r => r.id === f.id);
        if (!exists) results.push({ ...f, score: f.score ?? 0.3 });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:recall] Search failed: ${msg}`);
    }
      results = db.search(query, cfg.maxResults * 2).map(r => ({ ...r, score: r.score ?? 0.5 }));
      mode = "fts";
    }
  } else if (embedding?.isAvailable) {
    mode = "hybrid";
    try {
      const userEmbedding = await embedding.embed(query);
      const vectorResults = db.vectorSearch(userEmbedding, cfg.maxResults * 2);
      if (vectorResults && vectorResults.length > 0) {
        results = vectorResults.map((r) => ({
          ...r,
          score: r.vectorScore ?? r.score ?? 0.5,
        }));
      }
    } catch (vecErr) {
      const msg = vecErr instanceof Error ? vecErr.message : String(vecErr);
      logger.warn?.(`[yaoyao-memory:recall] Vector search failed, falling back to FTS5: ${msg}`);
    }
  }

  if (results.length === 0) {
    const ftsResults = db.search(query, cfg.maxResults * 2);
    results = ftsResults.map((r) => ({ ...r, score: r.score ?? 0.5 }));
    mode = "fts";
  }

  return { results, mode };
}
