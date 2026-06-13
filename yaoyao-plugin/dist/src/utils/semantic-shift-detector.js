/**
 * utils/semantic-shift-detector.ts — GAM-style semantic shift detection
 * with SimpleMem-inspired entropy-aware topic scoring.
 *
 * Inspired by:
 *   - "GAM: Hierarchical Graph-based Agentic Memory" — decouple encoding
 *     from consolidation, flush on semantic shift.
 *   - "SimpleMem: Efficient Lifelong Memory" (arXiv:2601.02553) — entropy-aware
 *     filtering: combine entity novelty ratio with semantic distance for
 *     more precise topic change detection.
 *
 * v1.8.0
 */
const DEFAULT_CONFIG = {
    enabled: true,
    threshold: 0.55,
    windowSize: 3,
    minContentLength: 30,
    maxBufferedCaptures: 10,
    maxIdleMs: 30_000,
    noveltyRatioThreshold: 0.25,
};
// ── SimpleMem-style shared stopword list ──
const STOP_WORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "been", "some", "same",
    "into", "than", "that", "this", "what", "with", "your", "from", "they",
    "were", "when", "will", "more", "also", "just", "like", "very",
    "well", "then", "them", "each", "such", "much", "here", "there", "about",
    "would", "could", "should", "their", "which", "these", "those", "after",
    "still", "being", "until", "while", "where", "doing", "other", "above",
    "also", "might", "shall", "really", "often", "never", "always", "maybe",
]);
// ── SimpleMem-style novelty ratio ──
// Measures how many new entity-bearing tokens appeared compared to the
// current topic. If a short text has high entity novelty (many new terms),
// it likely signals a topic shift even if length is below minContentLength.
function computeNoveltyRatio(newContent, currentTopic) {
    const extractEntities = (text) => {
        return new Set(text.toLowerCase().split(/\s+/)
            .filter(t => t.length > 3 && !STOP_WORDS.has(t)));
    };
    const newEntities = extractEntities(newContent);
    const topicEntities = extractEntities(currentTopic);
    if (newEntities.size === 0)
        return 0;
    // Novelty = proportion of new entities NOT in the current topic
    const novel = [...newEntities].filter(e => !topicEntities.has(e)).length;
    return novel / newEntities.size;
}
// ── Lightweight topic extraction ──
/**
 * Extract a "topic fingerprint" from content.
 * Uses keyword extraction (frequency-based) rather than full embedding.
 * Returns a sorted array of the most characteristic tokens.
 */
function extractTopicKeywords(text, topN = 8) {
    const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff\s]/g, " ").trim();
    const tokens = normalized.split(/\s+/).filter((t) => t.length > 1);
    // Count frequency
    const freq = new Map();
    for (const token of tokens) {
        freq.set(token, (freq.get(token) || 0) + 1);
    }
    // TF-IDF-like: score = frequency * (1 / rarity in text)
    // For simplicity, just take the most frequent tokens
    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([token]) => token);
}
/**
 * Compute topic similarity between two texts.
 * Uses Jaccard on extracted keywords for speed (no embedding needed).
 */
function topicSimilarity(textA, textB) {
    const keywordsA = extractTopicKeywords(textA);
    const keywordsB = extractTopicKeywords(textB);
    if (keywordsA.length === 0 || keywordsB.length === 0)
        return 0;
    const setA = new Set(keywordsA);
    const setB = new Set(keywordsB);
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}
// ── Main detector ──
export class SemanticShiftDetector {
    config;
    topicWindow = [];
    capturedCount = 0;
    lastFlushTime = Date.now();
    currentTopic = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Evaluate a new capture event for semantic shift.
     * Call this BEFORE debouncing/merging the event.
     *
     * @returns true if a shift was detected (caller should flush)
     */
    evaluate(content) {
        if (!this.config.enabled) {
            return {
                isShift: false,
                similarityToCurrent: 1,
                currentTopic: "",
                bufferedCount: this.capturedCount,
                reason: "detector disabled",
            };
        }
        // Safety valves
        const timeSinceFlush = Date.now() - this.lastFlushTime;
        if (this.capturedCount >= this.config.maxBufferedCaptures) {
            return {
                isShift: true,
                similarityToCurrent: 0,
                currentTopic: this.currentTopic?.source.slice(0, 80) ?? "",
                bufferedCount: this.capturedCount,
                reason: `max buffered (${this.capturedCount}) exceeded`,
            };
        }
        if (timeSinceFlush >= this.config.maxIdleMs) {
            return {
                isShift: true,
                similarityToCurrent: 0,
                currentTopic: this.currentTopic?.source.slice(0, 80) ?? "",
                bufferedCount: this.capturedCount,
                reason: `max idle (${(timeSinceFlush / 1000).toFixed(0)}s) exceeded`,
            };
        }
        // SimpleMem-style: even short content can signal a topic change
        // if its entity novelty ratio is high.
        // Minimum entity count guard: single words like "thanks" or "yeah"
        // shouldn't trigger a shift even if they are novel.
        if (content.length < this.config.minContentLength && this.currentTopic) {
            const noveltyRatio = computeNoveltyRatio(content, this.currentTopic.source);
            const newEntityCount = content.toLowerCase().split(/\s+/)
                .filter(t => t.length > 3 && !STOP_WORDS.has(t)).length;
            if (noveltyRatio >= this.config.noveltyRatioThreshold && newEntityCount >= 2) {
                // Short but novel → force a shift
                const keywords = extractTopicKeywords(content);
                const newTopic = {
                    source: content,
                    keywords,
                    timestamp: Date.now(),
                };
                this.topicWindow.push(newTopic);
                if (this.topicWindow.length > this.config.windowSize) {
                    this.topicWindow.shift();
                }
                this.currentTopic = newTopic;
                this.capturedCount = 1;
                return {
                    isShift: true,
                    similarityToCurrent: 0,
                    currentTopic: content.slice(0, 80),
                    bufferedCount: this.capturedCount,
                    reason: `high novelty ratio (${noveltyRatio.toFixed(3)} >= ${this.config.noveltyRatioThreshold}) despite short content`,
                };
            }
            // Too few entity tokens or low novelty → stay on same topic
            this.capturedCount++;
            return {
                isShift: false,
                similarityToCurrent: 1,
                currentTopic: this.currentTopic.source.slice(0, 80) ?? "",
                bufferedCount: this.capturedCount,
                reason: "content too short for shift detection",
            };
        }
        // Normal path for content >= minContentLength
        // Compare with current topic
        if (!this.currentTopic) {
            // First topic: initialize
            const keywords = extractTopicKeywords(content);
            this.currentTopic = { source: content, keywords, timestamp: Date.now() };
            this.topicWindow.push(this.currentTopic);
            this.capturedCount = 1;
            return {
                isShift: false,
                similarityToCurrent: 1,
                currentTopic: content.slice(0, 80),
                bufferedCount: this.capturedCount,
                reason: "initial topic",
            };
        }
        // Compute similarity with current topic
        const sim = topicSimilarity(content, this.currentTopic.source);
        const isShift = sim < this.config.threshold;
        if (isShift) {
            // Push new topic
            const newKeywords = extractTopicKeywords(content);
            const newTopic = {
                source: content,
                keywords: newKeywords,
                timestamp: Date.now(),
            };
            this.topicWindow.push(newTopic);
            if (this.topicWindow.length > this.config.windowSize) {
                this.topicWindow.shift();
            }
            this.currentTopic = newTopic;
            this.capturedCount = 1;
        }
        else {
            // Same topic: update current topic (merge content)
            this.currentTopic.source = content;
            this.currentTopic.keywords = extractTopicKeywords(content);
            this.currentTopic.timestamp = Date.now();
            this.capturedCount++;
        }
        return {
            isShift,
            similarityToCurrent: sim,
            currentTopic: this.currentTopic.source.slice(0, 80),
            bufferedCount: this.capturedCount,
            reason: isShift
                ? `semantic shift detected (sim=${sim.toFixed(3)} < ${this.config.threshold})`
                : `same topic (sim=${sim.toFixed(3)} >= ${this.config.threshold})`,
        };
    }
    /** Call after a flush to reset the counter. */
    markFlushed() {
        this.capturedCount = 0;
        this.lastFlushTime = Date.now();
    }
    /** Reset the detector entirely (e.g., on session reset). */
    reset() {
        this.topicWindow = [];
        this.capturedCount = 0;
        this.lastFlushTime = Date.now();
        this.currentTopic = null;
    }
    /** Get diagnostics. */
    stats() {
        return {
            topicWindowSize: this.topicWindow.length,
            capturedCount: this.capturedCount,
            idleSec: Math.round((Date.now() - this.lastFlushTime) / 1000),
            currentTopicSnippet: this.currentTopic?.source.slice(0, 60) ?? "(none)",
        };
    }
}
