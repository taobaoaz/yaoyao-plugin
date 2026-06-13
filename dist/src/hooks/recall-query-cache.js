/**
 * hooks/recall-query-cache.ts — Repeat-query detection for recall.
 *
 * Tracks recent queries to avoid redundant searches.
 * Per-hook-instance state is maintained by the caller.
 */
const MAX_RECENT_QUERIES = 20;
export function checkRepeatQuery(query, maxResults, minScore, recentQueries) {
    const normalized = query.toLowerCase().trim();
    if (!normalized)
        return undefined;
    const dup = recentQueries.find((q) => q.query === normalized && q.maxResults === maxResults && q.minScore === minScore);
    if (dup) {
        if (dup.hitCount === 0) {
            return "This exact query with the same parameters was already tried and returned 0 results. Try rephrasing.";
        }
        return "This exact query was already executed. Consider varying the query to get different results.";
    }
    return undefined;
}
export function recordRecentQuery(query, maxResults, minScore, hitCount, recentQueries) {
    const normalized = query.toLowerCase().trim();
    if (!normalized)
        return;
    const existing = recentQueries.findIndex((q) => q.query === normalized && q.maxResults === maxResults && q.minScore === minScore);
    if (existing !== -1)
        recentQueries.splice(existing, 1);
    recentQueries.push({ query: normalized, maxResults, minScore, hitCount });
    if (recentQueries.length > MAX_RECENT_QUERIES)
        recentQueries.shift();
}
