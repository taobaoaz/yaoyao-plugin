/**
 * features/atomic-fact/tool.ts — Atomic fact extraction and query tools.
 */

import type { ToolRegistration } from "../../tools/common.ts";
import { extractAtomicFacts } from "../../core/atomic/extract.ts";
import { saveFact, findFactsByEntity, getAllFacts } from "../../core/atomic/store.ts";
import { queryFacts, summarizeFacts } from "../../core/atomic/query.ts";

export function createAtomicFactTool(): ToolRegistration {
  return {
    name: "memory_atomic_fact",
    description: "Extract, store, and query atomic facts (subject-predicate-object).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["extract", "query", "summarize", "list"],
          description: "Action to perform",
        },
        text: { type: "string", description: "Text to extract facts from (for extract)" },
        mode: {
          type: "string",
          enum: ["regex", "llm", "hybrid"],
          description: "Extraction mode",
          default: "hybrid",
        },
        query: { type: "string", description: "Query string (for query)" },
        entity: { type: "string", description: "Entity to search (for query)" },
      },
      required: ["action"],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = args.action as string;

      if (action === "extract") {
        const text = args.text as string;
        const mode = (args.mode as string) ?? "hybrid";
        const result = extractAtomicFacts(text, mode as "regex" | "llm" | "hybrid");

        // Auto-save extracted facts
        for (const fact of result.facts) {
          saveFact(fact);
        }

        return {
          extracted: result.facts.length,
          entities: result.entities,
          discarded: result.discarded,
          facts: result.facts.map((f) => ({
            id: f.id,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          })),
        };
      }

      if (action === "query") {
        const queryStr = args.query as string;
        const entity = args.entity as string;

        let facts;
        if (entity) {
          facts = findFactsByEntity(entity);
        } else {
          facts = queryFacts(queryStr);
        }

        return {
          count: facts.length,
          facts: facts.slice(0, 10).map((f) => ({
            id: f.id,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          })),
        };
      }

      if (action === "summarize") {
        const allFacts = getAllFacts();
        const summary = summarizeFacts(allFacts);
        return { summary, count: allFacts.length };
      }

      if (action === "list") {
        const allFacts = getAllFacts();
        return {
          count: allFacts.length,
          facts: allFacts.slice(0, 20).map((f) => ({
            id: f.id,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          })),
        };
      }

      return { error: "Unknown action" };
    },
  };
}
