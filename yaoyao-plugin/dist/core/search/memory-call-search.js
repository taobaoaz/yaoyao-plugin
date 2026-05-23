/**
 * core/search/memory-call-search.ts — Execute structured MemoryCall queries.
 *
 * Bridges MemoryCall structured queries to the storage layer,
 * applying intent-aware re-ranking and time-range filtering.
 */
import { buildSearchQuery, buildDateFilter } from "../../utils/memory-call.js";
import { INTENT_WEIGHTS } from "./intent.js";
/**
 * Execute a MemoryCall structured query against storage.
 * Returns scored, filtered, and intent-re-ranked results.
 */
export async function executeMemoryCall(call, opts) {
    const { storage, embedding, tz = "Asia/Shanghai" } = opts;
    // Build search string from structured call
    const query = buildSearchQuery(call);
    if (!query || query.trim().length < 2)
        return [];
    const maxResults = call.maxResults ?? 10;
    const minScore = call.minScore ?? 0.3;
    // ── Search: hybrid (FTS + vector) ──
    let results = [];
    if (embedding?.isAvailable) {
        try {
            const vec = await embedding.embed(query);
            const hybridResults = storage.hybridSearch(query, vec, maxResults * 2);
            results = hybridResults.map((r) => ({
                ...r,
                score: r.hybridScore ?? r.score ?? 0.5,
            }));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:memory-call] Vector search failed, falling back to FTS5: ${msg}`);
            results = storage.search(query, maxResults * 2);
        }
    }
    else {
        results = storage.search(query, maxResults * 2);
    }
    if (results.length === 0)
        return [];
    // ── Time-range filtering ──
    const dateFilter = buildDateFilter(call.timeRange, tz);
    if (dateFilter) {
        results = results.filter((r) => {
            if (!r.date)
                return true;
            // Simple date range check: parse date filter clause
            if (call.timeRange?.relative === "today") {
                const today = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
                return r.date === today;
            }
            if (call.timeRange?.relative === "yesterday") {
                const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
                return r.date === y.toLocaleDateString("sv-SE", { timeZone: tz });
            }
            if (call.timeRange?.relative === "recent") {
                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                return r.date >= weekAgo.toLocaleDateString("sv-SE", { timeZone: tz });
            }
            return true;
        });
    }
    // ── Intent-aware re-ranking ──
    if (call.intent && INTENT_WEIGHTS[call.intent]) {
        const weights = INTENT_WEIGHTS[call.intent];
        for (const r of results) {
            const vecScore = r.vectorScore ?? r.score;
            const ts = r.timestamp;
            const tempScore = ts ? Math.pow(0.5, (Date.now() - ts) / (30 * 24 * 60 * 60 * 1000)) : 0.5;
            r.score = weights.fts * r.score + weights.vector * vecScore + weights.temporal * tempScore;
        }
        results.sort((a, b) => b.score - a.score);
    }
    // ── Score threshold ──
    results = results.filter((r) => r.score >= minScore);
    // ── Limit ──
    return results.slice(0, maxResults);
}
