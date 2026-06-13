/**
 * core/search/cluster-id-sink.ts — Append-only cluster tagger for new memories.
 *
 * Wraps GMM clustering with a sliding-window model:
 *   1. Maintain a ring buffer of the most recent N (text, embedding?) items.
 *   2. When the buffer is full (>= minClusterSize), train a GMM model.
 *   3. For each new memory, call `assignToCluster` against the cached model
 *      and append a `cluster:<id>:conf:<f>` tag to the meta string.
 *   4. Periodically (every refreshInterval captures) retrain the model with
 *      the latest buffer contents to adapt to topic drift.
 *
 * Why a separate sink (not embedded in gmm-cluster.ts):
 *   - Keeps pure-math code separate from stateful plugin code.
 *   - Allows test of the sink with a mock fetcher.
 *   - Lazy initialization: no model trained until we have enough samples.
 *
 * Singleton via `getClusterIdSink()`.
 */
import { clusterMemories, assignToCluster, } from "./gmm-cluster.js";
const DEFAULTS = {
    bufferSize: 64,
    minClusterSize: 12,
    k: 4,
    refreshInterval: 8,
    featureDim: 8,
    seed: 42,
};
export class ClusterIdSink {
    opts;
    buffer = [];
    model = null;
    captureCount = 0;
    /** Stable id counter for items that don't have one. */
    nextLocalId = 0;
    constructor(opts = {}) {
        this.opts = { ...DEFAULTS, ...opts };
    }
    /**
     * Feed a new memory item and return its cluster assignment.
     * Always succeeds (returns { clusterId: 0, modeled: false } when buffer is cold).
     */
    feed(item) {
        const id = item.id || `local-${++this.nextLocalId}`;
        const full = { id, text: item.text, embedding: item.embedding };
        this.buffer.push(full);
        while (this.buffer.length > this.opts.bufferSize)
            this.buffer.shift();
        this.captureCount += 1;
        // Cold start: not enough samples yet
        if (this.buffer.length < this.opts.minClusterSize) {
            return { clusterId: 0, confidence: 0, modeled: false };
        }
        // Retrain periodically
        if (this.model === null || this.captureCount % this.opts.refreshInterval === 0) {
            try {
                const result = clusterMemories(this.buffer, {
                    k: this.opts.k,
                    featureDim: this.opts.featureDim,
                    seed: this.opts.seed + this.captureCount, // shift seed slightly per retrain
                });
                this.model = result.model;
            }
            catch {
                // GMM failure → fallback
                return { clusterId: 0, confidence: 0, modeled: false };
            }
        }
        const a = assignToCluster(full, this.model, this.opts.featureDim);
        return { clusterId: a.clusterId, confidence: a.confidence, modeled: true };
    }
    /** Format the cluster tag for inclusion in a meta string. */
    static formatTag(assignment) {
        if (!assignment.modeled)
            return '';
        return `cluster:${assignment.clusterId}:conf:${assignment.confidence.toFixed(3)}`;
    }
    /** Append cluster tag to an existing meta string. */
    static appendToMeta(meta, assignment) {
        const tag = ClusterIdSink.formatTag(assignment);
        if (!tag)
            return meta ?? '';
        return meta ? `${meta};${tag}` : tag;
    }
    /** Inspect buffer/model state (for tests). */
    inspect() {
        return {
            bufferSize: this.buffer.length,
            modelTrained: this.model !== null,
            captureCount: this.captureCount,
            k: this.model?.k ?? this.opts.k,
        };
    }
    /** Clear all state (for tests / on plugin unload). */
    reset() {
        this.buffer.length = 0;
        this.model = null;
        this.captureCount = 0;
        this.nextLocalId = 0;
    }
}
let singleton = null;
/** Get the global cluster-id sink. */
export function getClusterIdSink(opts) {
    if (!singleton)
        singleton = new ClusterIdSink(opts);
    return singleton;
}
/** Test helper: reset the singleton. */
export function resetClusterIdSink() {
    if (singleton)
        singleton.reset();
    singleton = null;
}
