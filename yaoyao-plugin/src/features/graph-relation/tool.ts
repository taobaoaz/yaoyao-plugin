/**
 * features/graph-relation/tool.ts — Memory graph relation tools.
 */

import type { ToolRegistration } from "../../tools/common.ts";
import {
  createRelation,
  addRelation,
  getRelatedMemories,
} from "../../core/graph/mutators.ts";
import type { RelationType } from "../../core/graph/types.ts";
import { formatGraphResults } from "../../core/graph/formatter.ts";

export function createGraphRelationTool(): ToolRegistration {
  return {
    name: "memory_graph_relation",
    description: "Create or query relationships between memories (supersedes, related, causes, part_of).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "query", "list_types"],
          description: "Action to perform",
        },
        sourceId: { type: "string", description: "Source memory ID" },
        targetId: { type: "string", description: "Target memory ID" },
        relationType: {
          type: "string",
          enum: ["supersedes", "related", "causes", "part_of"],
          description: "Type of relationship",
        },
        strength: {
          type: "number",
          description: "Relationship strength 0.0-1.0",
          minimum: 0,
          maximum: 1,
        },
        maxDepth: {
          type: "number",
          description: "Max traversal depth for query",
          minimum: 1,
          maximum: 3,
          default: 1,
        },
        minStrength: {
          type: "number",
          description: "Minimum strength filter",
          minimum: 0,
          maximum: 1,
          default: 0.3,
        },
      },
      required: ["action"],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = args.action as string;

      if (action === "create") {
        const sourceId = args.sourceId as string;
        const targetId = args.targetId as string;
        const type = args.relationType as RelationType;
        const strength = (args.strength as number) ?? 0.5;

        const relation = createRelation(sourceId, targetId, type, strength);
        addRelation(relation);

        return {
          success: true,
          relation: {
            id: relation.id,
            sourceId: relation.sourceId,
            targetId: relation.targetId,
            type: relation.type,
            strength: relation.strength,
          },
        };
      }

      if (action === "query") {
        const sourceId = args.sourceId as string;
        const maxDepth = (args.maxDepth as number) ?? 1;
        const minStrength = (args.minStrength as number) ?? 0.3;

        const related = getRelatedMemories(sourceId, maxDepth, minStrength);

        return {
          sourceId,
          relatedMemories: related,
          count: related.length,
          maxDepth,
          minStrength,
        };
      }

      if (action === "list_types") {
        return {
          types: [
            { id: "supersedes", description: "Newer memory replaces older" },
            { id: "related", description: "Memories are semantically connected" },
            { id: "causes", description: "Source causes or leads to target" },
            { id: "part_of", description: "Source is part of target" },
          ],
        };
      }

      return { error: "Unknown action" };
    },
  };
}
