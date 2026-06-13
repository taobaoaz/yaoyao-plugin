/**
 * utils/memory-backprop.ts — A-Mem style cross-memory tag back-propagation
 * with MemRL-inspired Two-Phase retrieval (arXiv:2601.03192).
 *
 * Phase 1 (pre-filter): Fast trigram Jaccard pre-filter to discard obviously
 *   unrelated candidates without running the full textSimilarity (which
 *   includes Levenshtein edit distance for short texts).
 * Phase 2 (classify): Only candidates that pass the pre-filter threshold
 *   get the full similarity + relation classification.
 *
 * Additional: StructMem-inspired dual-view hint (fact + relation) via
 *   the `relationAnchor` parameter on process().
 *
 * v1.8.0
 */
import { textSimilarity } from "./batch-dedup.js";
const DEFAULT_CONFIG = {
    enabled: true,
    minSimilarity: 0.4,
    scanCount: 20,
    reinforceBump: 0.05,
    maxConfidence: 0.95,
    preFilterThreshold: 0.15,
};
// ── Fast trigram pre-filter (Phase 1 of MemRL Two-Phase) ──
// Much cheaper than full textSimilarity (which blends trigram + Levenshtein).
function trigramJaccardQuick(a, b) {
    const trigrams = (s) => {
        const set = new Set();
        const norm = s.toLowerCase().replace(/\s+/g, " ").trim();
        for (let i = 0; i <= norm.length - 3; i++) {
            set.add(norm.slice(i, i + 3));
        }
        return set;
    };
    const ta = trigrams(a);
    const tb = trigrams(b);
    if (ta.size === 0 || tb.size === 0)
        return 0;
    const intersection = new Set([...ta].filter((x) => tb.has(x)));
    const union = new Set([...ta, ...tb]);
    return intersection.size / union.size;
}
// ── Conflict heuristics ──
/**
 * Detect if two texts are in direct contradiction.
 * Uses surface-level negation and antonym detection.
 */
function detectContradiction(textA, textB) {
    const a = textA.toLowerCase();
    const b = textB.toLowerCase();
    const contradictionWords = /\b(no longer|not anymore|changed my mind|hate|dislike|don't|doesn't|didn't|can't|won't)\b/i;
    const entityOverlap = (() => {
        const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
        const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
        if (wordsA.size === 0 || wordsB.size === 0)
            return 0;
        const shared = [...wordsA].filter(w => wordsB.has(w)).length;
        return shared / Math.min(wordsA.size, wordsB.size);
    })();
    if (contradictionWords.test(a) && entityOverlap > 0.3)
        return true;
    if (contradictionWords.test(b) && entityOverlap > 0.3)
        return true;
    return false;
}
// ── Classification ──
function classifyRelation(newText, oldText, similarity, config) {
    // Check contradiction first (high priority)
    if (similarity > config.minSimilarity && detectContradiction(newText, oldText)) {
        return { relation: "contradicts", confidence: Math.min(1, similarity + 0.2) };
    }
    // Very high similarity: reinforces or elaborates
    if (similarity > 0.6) {
        if (newText.length > oldText.length * 1.4) {
            return { relation: "elaborates", confidence: similarity };
        }
        return { relation: "reinforces", confidence: similarity };
    }
    // Medium-high similarity with change indicators: supersedes
    if (similarity > 0.5) {
        const hasChange = /\b(now|changed|different|prefer|switch|use|like|love|hate)\b/i.test(newText);
        if (hasChange) {
            return { relation: "supersedes", confidence: similarity };
        }
    }
    return { relation: "none", confidence: 0 };
}
// ── Main engine ──
export class MemoryBackprop {
    config;
    processedFingerprints = new Set();
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Process a new memory against history. Returns all backprop actions taken.
     *
     * MemRL Two-Phase retrieval:
     *   Phase 1: Fast trigram Jaccard pre-filter (O(n) cheap)
     *   Phase 2: Full textSimilarity + classifyRelation on survivors
     *
     * @param newText     The content of the newly captured memory
     * @param newMeta     Meta string of the new memory
     * @param db          DBBridge for querying historical memories
     * @param embedding   Optional embedding service for vector search
     */
    async process(newText, newMeta, db, embedding) {
        if (!this.config.enabled)
            return [];
        const results = [];
        const newFingerprint = this._fingerprint(newText);
        // Skip if already processed (fingerprint cache)
        if (this.processedFingerprints.has(newFingerprint))
            return [];
        this.processedFingerprints.add(newFingerprint);
        if (this.processedFingerprints.size > 200) {
            const iter = this.processedFingerprints.values();
            for (let i = 0; i < 50; i++) {
                const val = iter.next();
                if (val.done)
                    break;
                this.processedFingerprints.delete(val.value);
            }
        }
        // Query candidates from DB
        let rawCandidates = [];
        try {
            if (embedding) {
                const vector = await embedding.embed(newText);
                const searchResults = db.vectorSearch(vector, this.config.scanCount);
                rawCandidates = searchResults.map((r) => ({
                    id: r.id ?? 0,
                    text: r.snippet ?? "",
                    meta: r.metadata ?? undefined,
                }));
            }
            else {
                const raw = db.getLatestMemory(this.config.scanCount);
                rawCandidates = raw.map((r) => ({
                    id: r.id ?? 0,
                    text: r.snippet ?? "",
                    meta: r.metadata ?? undefined,
                }));
            }
        }
        catch {
            return [];
        }
        if (rawCandidates.length === 0)
            return [];
        // ── MemRL Phase 1: Fast trigram pre-filter ──
        // Discard candidates with very low trigram overlap. This skips the
        // expensive textSimilarity (which includes Levenshtein for short texts).
        const preQualified = [];
        for (const c of rawCandidates) {
            if (!c.text || c.text === newText)
                continue;
            const quickSim = trigramJaccardQuick(newText, c.text);
            if (quickSim >= this.config.preFilterThreshold) {
                preQualified.push(c);
            }
        }
        // ── Phase 2: Full similarity + relation classification ──
        for (const candidate of preQualified) {
            if (!candidate.text)
                continue;
            const similarity = textSimilarity(newText, candidate.text);
            if (similarity < this.config.minSimilarity)
                continue;
            const { relation, confidence } = classifyRelation(newText, candidate.text, similarity, this.config);
            if (relation === "none")
                continue;
            let action = "none";
            let reason = "";
            switch (relation) {
                case "supersedes": {
                    const existingMeta = candidate.meta || "";
                    if (!existingMeta.includes("[superseded")) {
                        action = "tag_updated";
                        reason = `memory #${candidate.id} superseded by new content (sim=${similarity.toFixed(3)})`;
                    }
                    break;
                }
                case "reinforces": {
                    action = "confidence_bumped";
                    reason = `memory #${candidate.id} reinforced by new content (sim=${similarity.toFixed(3)})`;
                    break;
                }
                case "elaborates": {
                    action = "tag_updated";
                    reason = `memory #${candidate.id} elaborated by new content (sim=${similarity.toFixed(3)})`;
                    break;
                }
                case "contradicts": {
                    action = "marked_contradicted";
                    reason = `memory #${candidate.id} contradicts new content (sim=${similarity.toFixed(3)})`;
                    break;
                }
            }
            if (action !== "none") {
                results.push({ relation, targetId: candidate.id, confidence, action, reason });
            }
        }
        return results;
    }
    _fingerprint(text) {
        let hash = 0x811c9dc5;
        const normalized = text.toLowerCase().trim().slice(0, 200);
        for (let i = 0; i < normalized.length; i++) {
            hash ^= normalized.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    }
    reset() {
        this.processedFingerprints.clear();
    }
}
