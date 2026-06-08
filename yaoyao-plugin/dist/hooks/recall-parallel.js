/**
 * hooks/recall-parallel.ts — Parallel claw-core + local recall search with smart merge.
 *
 * Encapsulates the coexist-mode parallel search and deduplication merge.
 * Pure function — all dependencies passed as parameters.
 */
import { doRecallSearch } from "./recall-search.js";
/** Run parallel claw-core + local search, merge and dedupe. */
export async function doParallelRecall(db, userText, primaryQuery, searchCfg, maxResults, embedding, clawBridge, apiLogger) {
    if (!clawBridge) {
        const localRes = await doRecallSearch(db, primaryQuery, searchCfg, embedding, apiLogger);
        return { results: localRes.results.slice(0, maxResults), mode: localRes.mode, source: 'local' };
    }
    // Parallel: local + claw-core
    const [localRes, clawRes] = await Promise.allSettled([
        doRecallSearch(db, primaryQuery, searchCfg, embedding, apiLogger),
        Promise.race([
            clawBridge.recall(userText, maxResults * 2),
            new Promise((_, reject) => setTimeout(() => reject(new Error('claw timeout')), 5000)),
        ]),
    ]);
    let localResults = [];
    let mode = 'fts';
    if (localRes.status === 'fulfilled') {
        localResults = localRes.value.results;
        mode = localRes.value.mode;
    }
    let clawResults = [];
    if (clawRes.status === 'fulfilled' && clawRes.value) {
        const raw = clawRes.value;
        if (raw.memories) {
            clawResults = raw.memories.map((m, i) => ({
                id: i,
                filename: '',
                snippet: m.content,
                score: m.confidence,
                date: new Date().toISOString().slice(0, 10),
                metadata: JSON.stringify({ source: m.source, claw_verified: raw.verified ?? false }),
            }));
        }
        apiLogger.debug?.(`[yaoyao-memory:recall] claw-core returned ${clawResults.length} memories`);
    }
    else {
        const reason = clawRes.status === 'rejected' ? String(clawRes.reason) : 'empty';
        apiLogger.debug?.(`[yaoyao-memory:recall] claw-core recall failed: ${reason}`);
    }
    if (clawResults.length === 0) {
        return { results: localResults.slice(0, maxResults), mode, source: 'local' };
    }
    // Smart merge: dedupe by content hash, prefer claw-core (already sorted by score)
    const seen = new Set();
    const merged = [];
    for (const r of [...clawResults, ...localResults]) {
        const key = r.snippet.slice(0, 200);
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(r);
        }
    }
    merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const results = merged.slice(0, maxResults);
    apiLogger.debug?.(`[yaoyao-memory:recall] merged ${clawResults.length}+${localResults.length} → ${results.length}`);
    return { results, mode, source: 'merged' };
}
