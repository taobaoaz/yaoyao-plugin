/**
 * features/graph-relation/tool.ts — Memory graph relation tools.
 */
import { createRelation, addRelation, getRelatedMemories, } from "../../core/graph/mutators.js";
export function createGraphRelationTool() {
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
        handler: async (args) => {
            const action = args.action;
            if (action === "create") {
                const sourceId = args.sourceId;
                const targetId = args.targetId;
                const type = args.relationType;
                const strength = args.strength ?? 0.5;
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
                const sourceId = args.sourceId;
                const maxDepth = args.maxDepth ?? 1;
                const minStrength = args.minStrength ?? 0.3;
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
