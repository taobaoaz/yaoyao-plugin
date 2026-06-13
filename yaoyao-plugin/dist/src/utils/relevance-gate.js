/**
 * utils/relevance-gate.ts — SRMU-style Relevance Gate for memory ingestion.
 *
 * Inspired by "SRMU: Relevance-Gated Updates for Streaming Hyperdimensional Memories"
 * (arXiv:2604.15121) and "SimpleMem: Efficient Lifelong Memory for LLM Agents"
 * (arXiv:2601.02553) entropy-aware filtering.
 *
 * Core factors:
 *   - Novelty: how different is this from recent memories? (text + vector)
 *   - Time decay: information value degrades with rapid repeats
 *   - Information density: entity-richness (SimpleMem-style entropy-aware)
 *   - Confidence: from source reliability and extraction quality
 *
 * v1.8.0
 */
const DEFAULT_CONFIG = {
    enabled: true,
    minScore: 0.45,
    noveltyThreshold: 0.7,
    ttlHalfLifeSec: 120,
    minInfoDensity: 0.08,
    noveltyLookback: 5,
    redundancyPenalty: 0.5,
    repeatBlockThreshold: 2,
    minContentLength: 15,
    entropyThreshold: 0.35,
};
// ── Lightweight content fingerprint (FNV-1a for speed) ──
function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
class TemporalDecayRing {
    entries = [];
    expiryMs;
    constructor(halfLifeSec) {
        this.expiryMs = halfLifeSec * 1000;
    }
    record(fingerprint) {
        this.entries.push({ fingerprint, time: Date.now() });
        this._sweep();
    }
    count(fingerprint) {
        this._sweep();
        return this.entries.filter((e) => e.fingerprint === fingerprint).length;
    }
    _sweep() {
        const cutoff = Date.now() - this.expiryMs;
        while (this.entries.length > 0 && this.entries[0].time < cutoff) {
            this.entries.shift();
        }
    }
    get size() {
        return this.entries.length;
    }
}
// ── SimpleMem-style entropy-aware information density ──
// Instead of simple distinct token / length ratio, measure entity-richness:
// proportion of tokens that carry semantic weight (>3 chars, not in stop-list).
// This mirrors SimpleMem's "entropy-aware filtering": low-entity text
// (e.g. "ok", "yeah", "I agree") gets penalized even if it's long.
const STOP_WORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "been", "some", "same",
    "into", "than", "that", "this", "what", "with", "your", "from", "they",
    "been", "were", "when", "will", "more", "also", "just", "like", "very",
    "well", "then", "them", "each", "such", "much", "here", "there", "about",
    "would", "could", "should", "their", "which", "these", "those", "after",
    "still", "being", "until", "while", "where", "doing", "other", "above",
    "also", "might", "shall", "really", "often", "never", "always", "maybe",
    "okay", "yeah", "nope", "yes", "no", "oh", "ah", "um", "hmm",
]);
function estimateInfoDensity(text) {
    if (text.length < 10)
        return 0;
    if (text.length < 20)
        return 0.3;
    const normalized = text.toLowerCase().trim();
    const tokens = normalized.split(/[\s,.;:!?()\[\]{}"']+/).filter(Boolean);
    if (tokens.length === 0)
        return 0;
    // SimpleMem-style: count entity-bearing tokens (length > 3, not stopword)
    // vs total tokens. Low entity ratio ≈ high entropy ≈ low information density.
    let entityTokens = 0;
    for (const t of tokens) {
        if (t.length > 3 && !STOP_WORDS.has(t))
            entityTokens++;
    }
    const entityRatio = entityTokens / tokens.length;
    // Also consider distinct token ratio (original heuristic)
    const distinct = new Set(tokens).size;
    const distinctRatio = distinct / tokens.length;
    // Blend: entity ratio dominates (SimpleMem insight), distinct ratio as fallback
    const combined = entityRatio * 0.6 + distinctRatio * 0.4;
    // Normalize: typical entity ratios range 0.2–0.8
    return Math.min(1, combined);
}
// ── Main engine ──
export class RelevanceGate {
    config;
    decayRing;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.decayRing = new TemporalDecayRing(this.config.ttlHalfLifeSec);
    }
    async evaluate(text, sourceId, recentTexts, embedding) {
        if (!this.config.enabled) {
            return {
                pass: true,
                score: 1,
                factors: { novelty: 1, timeDecay: 1, infoDensity: 1, confidence: 1 },
                reason: "gate disabled",
            };
        }
        const fingerprint = fnv1a(text);
        // ── Length check: extremely short content is noise ──
        if (text.length < this.config.minContentLength) {
            return {
                pass: false,
                score: 0,
                factors: { novelty: 0, timeDecay: 1, infoDensity: 0, confidence: 0.1 },
                reason: `content too short (${text.length} < ${this.config.minContentLength})`,
            };
        }
        // ── SimpleMem-style entropy pre-filter ──
        // Low entity-ratio content likely carries no useful information even if long.
        const infoDensity = estimateInfoDensity(text);
        if (infoDensity < this.config.entropyThreshold) {
            return {
                pass: false,
                score: infoDensity * 0.5,
                factors: { novelty: 0.5, timeDecay: 1, infoDensity, confidence: 0.3 },
                reason: `low entity density (${infoDensity.toFixed(3)} < ${this.config.entropyThreshold})`,
            };
        }
        // ── Factor 1: Time-decay penalty ──
        const repeatCount = this.decayRing.count(fingerprint);
        // SRMU-style: block if repeated excessively within half-life window
        if (repeatCount >= this.config.repeatBlockThreshold) {
            return {
                pass: false,
                score: 0.1,
                factors: { novelty: 0, timeDecay: 0.1, infoDensity, confidence: 0.5 },
                reason: `excessive repeat (count=${repeatCount})`,
            };
        }
        // Time decay: first repeat gets a strong penalty
        const timeDecay = repeatCount === 0 ? 1 : 0.2;
        // ── Factor 2: Novelty (text similarity to recent memories) ──
        let novelty = 1;
        if (recentTexts.length > 0) {
            const tokens = new Set(text.toLowerCase().split(/[\s,.;:!?]+/).filter((t) => t.length > 2));
            let maxSim = 0;
            for (const recent of recentTexts.slice(0, this.config.noveltyLookback)) {
                const recentTokens = new Set(recent.toLowerCase().split(/[\s,.;:!?]+/).filter((t) => t.length > 2));
                if (tokens.size === 0 || recentTokens.size === 0)
                    continue;
                const intersection = new Set([...tokens].filter((x) => recentTokens.has(x)));
                const union = new Set([...tokens, ...recentTokens]);
                const sim = intersection.size / union.size;
                if (sim > maxSim)
                    maxSim = sim;
            }
            novelty = 1 - Math.min(1, maxSim / (this.config.noveltyThreshold || 0.01));
            if (novelty < 0)
                novelty = 0;
        }
        // ── Factor 4: Confidence (content-length-based heuristic) ──
        let confidence = 1;
        if (text.length < 10)
            confidence = 0.1;
        else if (text.length < 30)
            confidence = 0.5;
        else if (text.length > 10000)
            confidence = 0.6;
        // ── Composite score — timeDecay dominates to gate rapid repeats ──
        const composite = timeDecay * 0.45 + novelty * 0.25 + infoDensity * 0.2 + confidence * 0.1;
        const pass = composite >= this.config.minScore;
        if (pass) {
            this.decayRing.record(fingerprint);
        }
        return {
            pass,
            score: Math.round(composite * 1000) / 1000,
            factors: {
                novelty: Math.round(novelty * 1000) / 1000,
                timeDecay: Math.round(timeDecay * 1000) / 1000,
                infoDensity: Math.round(infoDensity * 1000) / 1000,
                confidence: Math.round(confidence * 1000) / 1000,
            },
            reason: pass
                ? `relevance ${composite.toFixed(3)} >= ${this.config.minScore}`
                : `relevance ${composite.toFixed(3)} < ${this.config.minScore}`,
        };
    }
    reset() {
        this.decayRing = new TemporalDecayRing(this.config.ttlHalfLifeSec);
    }
}
