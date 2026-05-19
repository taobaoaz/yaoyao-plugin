/**
 * core/atomic/query.ts — Atomic fact query and reasoning utilities.
 */

import type { AtomicFact } from "./types.ts";
import { getAllFacts, findFactsByEntity } from "./store.ts";

/** Find facts matching a natural language query (simple keyword matching). */
export function queryFacts(query: string): AtomicFact[] {
  const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length >= 2);
  const allFacts = getAllFacts();

  return allFacts.filter((fact) => {
    const text = `${fact.subject} ${fact.predicate} ${fact.object} ${fact.tags.join(" ")}`.toLowerCase();
    return keywords.some((k) => text.includes(k));
  }).sort((a, b) => b.confidence - a.confidence);
}

/** Find all facts about a specific entity (as subject or object). */
export function getEntityFacts(entity: string): AtomicFact[] {
  return findFactsByEntity(entity);
}

/** Build a simple knowledge graph from facts. */
export function buildFactGraph(facts: AtomicFact[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const fact of facts) {
    if (!graph[fact.subject]) graph[fact.subject] = [];
    graph[fact.subject].push(`${fact.predicate} ${fact.object}`);
  }

  return graph;
}

/** Generate a human-readable summary of facts. */
export function summarizeFacts(facts: AtomicFact[]): string {
  if (facts.length === 0) return "No facts found.";

  const lines = [`## 📊 Fact Summary (${facts.length})`, ""];

  // Group by subject
  const bySubject: Record<string, AtomicFact[]> = {};
  for (const fact of facts) {
    if (!bySubject[fact.subject]) bySubject[fact.subject] = [];
    bySubject[fact.subject].push(fact);
  }

  for (const [subject, subjectFacts] of Object.entries(bySubject)) {
    lines.push(`### ${subject}`);
    for (const fact of subjectFacts) {
      const confidenceEmoji = fact.confidence > 0.8 ? "🟢" : fact.confidence > 0.5 ? "🟡" : "🔴";
      lines.push(`- ${confidenceEmoji} ${fact.predicate} ${fact.object} (${(fact.confidence * 100).toFixed(0)}%)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
