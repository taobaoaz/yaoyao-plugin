import { formatMultiSignalResults } from "../../core/search/multi-signal.js";
import { formatAdditiveResults } from "../../core/search/additive-scorer.js";
export function mergeAndDedupResults(fts, vec) {
    const seen = new Set();
    const merged = [];
    for (const r of fts) {
        const key = r.id ?? r.snippet;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(r);
    }
    for (const r of vec) {
        const id = typeof r.id === "number" ? r.id : undefined;
        const snippet = typeof r.snippet === "string" ? r.snippet : "";
        const key = id ?? snippet;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push({
            id,
            filename: typeof r.filename === "string" ? r.filename : "",
            snippet,
            score: typeof r.score === "number" ? r.score : 0.5,
            date: typeof r.date === "string" ? r.date : "",
        });
    }
    return merged;
}
export function formatJsonResults(query, topResults, allResultsCount, fusionMode) {
    return JSON.stringify({
        query,
        count: topResults.length,
        totalCandidates: allResultsCount,
        fusionMode,
        results: topResults.map((r) => ({
            id: r.id,
            snippet: (String(r.snippet ?? "")).slice(0, 200),
            date: r.date,
            score: r.score,
            signals: r.signals,
            source: r.source,
        })),
    }, null, 2);
}
export function formatTextResults(topResults, query, fusionMode, allResultsCount) {
    const text = fusionMode === "additive"
        ? formatAdditiveResults(topResults, query)
        : formatMultiSignalResults(topResults, query);
    return text + `\nFusion mode: ${fusionMode === "additive" ? "Additive Scoring" : "RRF"} | ${allResultsCount} candidates merged to ${topResults.length} results.`;
}
