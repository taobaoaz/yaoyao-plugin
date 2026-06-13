/**
 * features/adaptive-search/tool.ts — Adaptive query-aware search tool.
 */

import type { ToolRegistration } from "../../tools/common.ts";
import { classifyQuery } from "../../core/adaptive/classify.ts";
import { resolveWeights, normalizeWeights } from "../../core/adaptive/weights.ts";

export function createAdaptiveSearchTool(): ToolRegistration {
  return {
    name: "memory_adaptive_search",
    description: "Query-aware search that automatically adjusts strategy based on query type (conceptual, temporal, causal, entity).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results", default: 10 },
        explain: { type: "boolean", description: "Include weight explanation", default: false },
      },
      required: ["query"],
    },
    handler: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) ?? 10;
      const explain = (args.explain as boolean) ?? false;

      const classification = classifyQuery(query);
      const rawWeights = resolveWeights(classification);
      const weights = normalizeWeights(rawWeights);

      const result: Record<string, unknown> = {
        query,
        classification: {
          type: classification.type,
          confidence: classification.confidence,
          keywords: classification.keywords,
        },
        weights: {
          semantic: weights.semantic,
          temporal: weights.temporal,
          graph: weights.graph,
          entity: weights.entity,
          keyword: weights.keyword,
        },
        maxResults,
      };

      if (explain) {
        result.explanation = `Query classified as "${classification.type}" (confidence: ${(classification.confidence * 100).toFixed(0)}%). ` +
          `Search weights adjusted: semantic ${(weights.semantic * 100).toFixed(0)}%, ` +
          `temporal ${(weights.temporal * 100).toFixed(0)}%, ` +
          `graph ${(weights.graph * 100).toFixed(0)}%, ` +
          `entity ${(weights.entity * 100).toFixed(0)}%, ` +
          `keyword ${(weights.keyword * 100).toFixed(0)}%.`;
      }

      return result;
    },
  };
}
