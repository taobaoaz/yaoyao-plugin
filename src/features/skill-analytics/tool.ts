/**
 * features/skill-analytics/tool.ts — Skill learning analytics tool.
 */

import type { ToolRegistration } from "../../tools/common.ts";
import { getTopPatterns, getToolStats } from "../../core/skills/tracker.ts";
import { analyzeSkills, formatSuggestions } from "../../core/skills/analyzer.ts";

export function createSkillAnalyticsTool(): ToolRegistration {
  return {
    name: "memory_skill_analytics",
    description: "Analyze tool usage patterns and suggest optimizations.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["patterns", "stats", "suggestions", "report"],
          description: "Action to perform",
        },
        toolId: { type: "string", description: "Tool ID for stats query" },
      },
      required: ["action"],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = args.action as string;

      if (action === "patterns") {
        const patterns = getTopPatterns(10);
        return {
          count: patterns.length,
          patterns: patterns.map((p) => ({
            id: p.id,
            toolId: p.toolId,
            frequency: p.frequency,
            avgDurationMs: p.avgDurationMs,
            confidence: p.confidence,
          })),
        };
      }

      if (action === "stats") {
        const toolId = args.toolId as string;
        if (!toolId) return { error: "toolId required for stats" };
        const stats = getToolStats(toolId);
        return stats ?? { error: "No data for this tool" };
      }

      if (action === "suggestions") {
        const suggestions = analyzeSkills();
        return {
          count: suggestions.length,
          suggestions: suggestions.map((s) => ({
            type: s.type,
            description: s.description,
            confidence: s.confidence,
            impact: s.estimatedImpact,
          })),
        };
      }

      if (action === "report") {
        const patterns = getTopPatterns(5);
        const suggestions = analyzeSkills();
        const report = formatSuggestions(suggestions);
        return {
          patterns: patterns.length,
          suggestions: suggestions.length,
          markdown: report,
        };
      }

      return { error: "Unknown action" };
    },
  };
}
