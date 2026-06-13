import { SimpleLRU } from "./simple-lru.js";
import { isDuplicateOfRecent } from "./batch-dedup.js";
const DEFAULT_OPTIONS = {
    enabled: true,
    hashLruSize: 500,
    vectorThreshold: 0.80,
    vectorTopN: 5,
    textThreshold: 0.85,
    textLookback: 10,
    recurrenceLo: 0.60,
};
// ── L1: In-memory content hash LRU ──
function contentHash(text, owner) {
    let hash = 0;
    const data = `${owner || "default"}:${text}`;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return `${owner || "default"}:${hash}`;
}
// ── Main engine ──
export class DedupEngine {
    hashCache;
    /** v1.8.1 (RecMem): Semantic recurrence tracker — maps content hash → recurrence count */
    recurrenceCache;
    opts;
    constructor(opts) {
        this.opts = { ...DEFAULT_OPTIONS, ...opts };
        this.hashCache = new SimpleLRU({ maxSize: this.opts.hashLruSize });
        this.recurrenceCache = new SimpleLRU({ maxSize: this.opts.hashLruSize });
    }
    /** Run all three stages in order. Returns as soon as any stage finds a match. */
    async check(text, db, embedding, owner) {
        if (!this.opts.enabled) {
            return { isDuplicate: false, stage: "none", confidence: 0, reason: "dedup disabled" };
        }
        // ── L1: Exact content hash ──
        const hash = contentHash(text, owner);
        if (this.hashCache.get(hash)) {
            // Record in LRU so it stays hot
            this.hashCache.set(hash, true);
            return { isDuplicate: true, stage: "hash", confidence: 1.0, reason: "exact content hash match" };
        }
        // ── L2: Vector cosine similarity (with RecMem recurrence detection) ──
        let recurrenceDetected = false;
        let recurrenceCount = 0;
        if (embedding?.isAvailable) {
            try {
                const queryVec = await embedding.embed(text, 30000);
                if (queryVec && queryVec.length > 0) {
                    const vecResults = db.vectorSearch(queryVec, this.opts.vectorTopN);
                    let maxSim = 0;
                    for (const vr of vecResults) {
                        const sim = typeof vr.vectorScore === "number" ? vr.vectorScore : 0;
                        if (sim > maxSim)
                            maxSim = sim;
                        if (sim >= this.opts.vectorThreshold) {
                            this.hashCache.set(hash, true);
                            return {
                                isDuplicate: true,
                                stage: "vector",
                                confidence: sim,
                                reason: `vector similarity ${sim.toFixed(3)} >= ${this.opts.vectorThreshold}`,
                            };
                        }
                    }
                    // v1.8.1 (RecMem): Check semantic recurrence band [recurrenceLo, vectorThreshold)
                    if (maxSim >= this.opts.recurrenceLo) {
                        const prevCount = this.recurrenceCache.get(hash) ?? 0;
                        recurrenceCount = prevCount + 1;
                        this.recurrenceCache.set(hash, recurrenceCount);
                        recurrenceDetected = true;
                    }
                }
            }
            catch (err) {
                console.debug?.(`[yaoyao-memory:dedup] L2 vector check failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // ── L3: Text similarity (trigram Jaccard + Levenshtein) ──
        try {
            const recent = db.getLatestMemory(this.opts.textLookback);
            const dup = isDuplicateOfRecent(text, recent, this.opts.textThreshold);
            if (dup) {
                this.hashCache.set(hash, true);
                return {
                    isDuplicate: true,
                    stage: "text",
                    confidence: this.opts.textThreshold,
                    reason: `text similarity >= ${this.opts.textThreshold}`,
                };
            }
        }
        catch (err) {
            console.debug?.(`[yaoyao-memory:dedup] L3 text check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Not a duplicate — record the hash so future exact repeats are caught
        this.hashCache.set(hash, true);
        return {
            isDuplicate: false,
            stage: "none",
            confidence: 0,
            reason: "unique content",
            ...(recurrenceDetected ? { recurrence: true, recurrenceCount } : {}),
        };
    }
    /** Get current hash cache size (for stats/debugging) */
    get hashCacheSize() {
        return this.hashCache.size;
    }
    /** v1.8.1 (RecMem): Get current recurrence tracker size */
    get recurrenceCacheSize() {
        return this.recurrenceCache.size;
    }
}
