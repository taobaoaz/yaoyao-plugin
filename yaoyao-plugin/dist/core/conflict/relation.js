/**
 * Suggest a conflict relation based on signal profile.
 */
export function suggestRelation(candidate) {
    if (candidate.signals.lexicalSimilarity > 0.7 &&
        candidate.signals.semanticOverlap > 0.6 &&
        candidate.signals.hasContradictionMarkers) {
        return "conflicts_with";
    }
    if (candidate.signals.semanticOverlap > 0.75) {
        return candidate.signals.hasContradictionMarkers ? "supersedes" : "related";
    }
    if (candidate.confidence > 0.5)
        return "related";
    return "compatible";
}
/**
 * Determine if a conflict can be auto-resolved without user input.
 */
export function canAutoResolve(candidate, suggestedRelation) {
    if (candidate.confidence < 0.7)
        return false;
    return !["supersedes", "conflicts_with"].includes(suggestedRelation);
}
export function serializeRelationRecord(record) {
    return JSON.stringify(record);
}
export function parseRelationRecord(json) {
    try {
        const p = JSON.parse(json);
        if (typeof p.memoryAId === "number" && typeof p.memoryBId === "number" &&
            typeof p.relation === "string" &&
            ["supersedes", "conflicts_with", "compatible", "related", "not_conflict"].includes(p.relation))
            return p;
        return null;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:conflict] Parse relation record failed: ${msg}`);
        return null;
    }
}
