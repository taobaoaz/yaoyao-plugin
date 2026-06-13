/**
 * core/graph/formatter.ts — Graph visualization and formatting utilities.
 */

import type { MemoryRelation, GraphSearchResult } from "./types.ts";

export function formatRelation(r: MemoryRelation): string {
  const typeEmoji: Record<string, string> = {
    supersedes: "🔄",
    related: "🔗",
    causes: "➡️",
    part_of: "📦",
  };
  return `${typeEmoji[r.type] ?? "🔗"} ${r.sourceId} ${r.type} ${r.targetId} (strength: ${(r.strength * 100).toFixed(0)}%)`;
}

export function formatGraphPath(path: MemoryRelation[]): string {
  if (path.length === 0) return "(no path)";
  return path.map(formatRelation).join(" → ");
}

export function formatGraphResults(results: GraphSearchResult[]): string {
  if (results.length === 0) return "No related memories found.";

  const lines = [
    `## 🔍 Graph Search Results (${results.length})`,
    "",
  ];

  for (const r of results) {
    lines.push(`### ${r.memoryId}`);
    lines.push(`- Depth: ${r.depth}`);
    lines.push(`- Path strength: ${(r.accumulatedStrength * 100).toFixed(0)}%`);
    lines.push(`- Path: ${formatGraphPath(r.path)}`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Generate Mermaid graph diagram from relations. */
export function generateMermaidDiagram(relations: MemoryRelation[]): string {
  const lines = ["graph TD"];

  for (const r of relations) {
    const label = r.type;
    lines.push(`  ${r.sourceId}["${r.sourceId}"] -->|"${label}"| ${r.targetId}["${r.targetId}"]`);
  }

  return lines.join("\n");
}

// === Legacy formatter ===
export function formatGraph(result: { query: string; nodes: unknown[]; edges: unknown[]; stats: unknown }): string {
  const lines = [
    `## 🔍 Graph: "${result.query}"`,
    "",
    `**Nodes**: ${result.nodes.length}`,
    `**Edges**: ${result.edges.length}`,
    "",
    "### Stats",
    "```json",
    JSON.stringify(result.stats, null, 2),
    "```",
  ];
  return lines.join("\n");
}
