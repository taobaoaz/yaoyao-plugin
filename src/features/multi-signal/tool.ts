/**
 * features/multi-signal/tool.ts — memory_search_multi tool (mem0 v3 inspired).
 *
 * Thin layer: param validation → search orchestration → formatter output.
 * Fusion algorithms live in core/search/, formatting in formatter.ts.
 */
import type { DBBridge, SearchResult } from "../../utils/db-bridge.ts";
import type { EmbeddingService } from "../../utils/embedding.ts";
import { clampNum } from "../../utils/clamp.ts";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import { multiSignalFusion } from "../../core/search/multi-signal.ts";
import { additiveScoreAndRank } from "../../core/search/additive-scorer.ts";
import { mergeAndDedupResults, formatJsonResults, formatTextResults } from "./formatter.ts";

type FusionMode = "rrf" | "additive";

export function createMultiSignalSearchTool(
  db: DBBridge,
  embedding?: EmbeddingService | null,
): ToolRegistration {
  return {
    id: "memory_search_multi",
    name: "memory_search_multi",
    label: "Multi-Signal Search",
    description:
      "Searches using multi-signal fusion (mem0 v3 style). Supports rrf (default) and additive modes. " +
      "Outputs per-result signal breakdown.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results (1-30, default 10)", default: 10 },
        format: { type: "string", enum: ["text", "json"], description: "Output format", default: "text" },
        temporalDecayDays: { type: "number", description: "Temporal decay half-life (0=disabled, default 30)", default: 30 },
        entityBoost: { type: "boolean", description: "Enable entity relevance boost (default true)", default: true },
        fusionMode: { type: "string", enum: ["rrf", "additive"], description: "Fusion mode", default: "rrf" },
      },
      required: ["query"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const query = String(params.query ?? "").trim();
      const limit = clampNum(params.maxResults, 10, 1, 30);
      const format = String(params.format || "text");
      const temporalDecayDays = clampNum(params.temporalDecayDays, 30, 0, 365);
      const enableEntityBoost = params.entityBoost !== false;
      const fusionMode = (String(params.fusionMode || "rrf") as FusionMode);

      if (!query) return { content: [{ type: "text", text: "Please enter a search query." }] };

      // 1. FTS5 search
      const ftsResults = db.search(query, limit * 2);

      // 2. Vector search (if available)
      let vecResults: any[] = [];
      if (embedding) {
        try {
          const queryVec = await embedding.embed(query, embedding.recallTimeoutMs);
          const rrfResults = db.rrfHybridSearch
            ? db.rrfHybridSearch(query, queryVec, limit * 2, 60)
            : db.hybridSearch(query, queryVec, limit * 2);
          vecResults = rrfResults;
        } catch { /* vector unavailable */ }
      }

      // 3. Merge candidates
      const allResults: SearchResult[] = mergeAndDedupResults(ftsResults, vecResults);
      if (allResults.length === 0) {
        return { content: [{ type: "text", text: "No matching memories found." }] };
      }

      // 4. Fusion
      let topResults: any[];

      if (fusionMode === "additive") {
        const candidates = allResults.map(r => ({
          id: r.id ?? r.snippet,
          snippet: r.snippet,
          semanticScore: r.score,
          date: r.date,
          filename: r.filename,
        }));

        const additiveResults = additiveScoreAndRank(query, candidates, {
          entityBoostWeight: enableEntityBoost ? 0.5 : 0,
          useEntityBoost: enableEntityBoost,
          useBM25: true,
          topK: limit,
          semanticThreshold: 0,
        });

        topResults = additiveResults.map(r => ({
          id: r.id,
          snippet: r.snippet,
          date: r.date,
          score: r.score,
          signals: r.signals,
          source: "additive",
          filename: r.filename,
        }));
      } else {
        const signalConfig: Record<string, unknown> = { temporalHalfLifeDays: temporalDecayDays };
        if (!enableEntityBoost) signalConfig.entityBoostMax = 0;

        const fused = multiSignalFusion(
          query,
          ftsResults,
          vecResults.map((r: any) => ({ ...r, asst_text: "", timestamp: undefined, importance: undefined, scope: undefined })),
          allResults,
          signalConfig,
        );

        topResults = fused.slice(0, limit);
      }

      // 5. Format output
      if (format === "json") {
        return { content: [{ type: "text", text: formatJsonResults(query, topResults, allResults.length, fusionMode) }] };
      }

      return { content: [{ type: "text", text: formatTextResults(topResults, query, fusionMode, allResults.length) }] };
    }),
  };
}
