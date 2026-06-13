/**
 * core/adaptive/search.ts — Adaptive search orchestrator.
 */
import { classifyQuery } from "./classify.js";
import { resolveWeights, normalizeWeights } from "./weights.js";
import { getRelatedMemories } from "../graph/mutators.js";
import { queryFacts } from "../atomic/query.js";
export function adaptiveSearch(query, options) {
    const classification = classifyQuery(query);
    const rawWeights = resolveWeights(classification);
    const weights = normalizeWeights(rawWeights);
    const results = new Map();
    // Semantic search
    if (weights.semantic > 0 && options?.semanticSearch) {
        const semanticResults = options.semanticSearch(query);
        for (const r of semanticResults) {
            const entry = results.get(r.id) ?? { score: 0, reasons: [] };
            entry.score += r.score * weights.semantic;
            entry.reasons.push(`semantic:${(r.score * weights.semantic).toFixed(3)}`);
            results.set(r.id, entry);
        }
    }
    // Keyword search
    if (weights.keyword > 0 && options?.keywordSearch) {
        const keywordResults = options.keywordSearch(query);
        for (const r of keywordResults) {
            const entry = results.get(r.id) ?? { score: 0, reasons: [] };
            entry.score += r.score * weights.keyword;
            entry.reasons.push(`keyword:${(r.score * weights.keyword).toFixed(3)}`);
            results.set(r.id, entry);
        }
    }
    // Graph traversal (for causal queries)
    if (weights.graph > 0) {
        const seedIds = [...results.keys()].slice(0, 3);
        for (const seedId of seedIds) {
            const related = getRelatedMemories(seedId, 1, 0.3);
            for (const relatedId of related) {
                const entry = results.get(relatedId) ?? { score: 0, reasons: [] };
                entry.score += 0.3 * weights.graph;
                entry.reasons.push(`graph:0.3x${weights.graph.toFixed(2)}`);
                results.set(relatedId, entry);
            }
        }
    }
    // Entity search (via atomic facts)
    if (weights.entity > 0) {
        const facts = queryFacts(query);
        for (const fact of facts) {
            // Map fact source to memory ID
            const memoryId = fact.source;
            if (!memoryId)
                continue;
            const entry = results.get(memoryId) ?? { score: 0, reasons: [] };
            entry.score += fact.confidence * weights.entity;
            entry.reasons.push(`entity:${fact.confidence.toFixed(2)}x${weights.entity.toFixed(2)}`);
            results.set(memoryId, entry);
        }
    }
    // Sort and limit
    const sorted = [...results.entries()]
        .map(([id, data]) => ({ memoryId: id, score: data.score, reasons: data.reasons }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options?.maxResults ?? 10);
    return sorted;
}
