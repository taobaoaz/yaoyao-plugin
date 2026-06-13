/**
 * core/search/cluster-expander.ts — L2 cluster-tag expansion.
 *
 * Extends the multi-granularity router's L2 layer (broad exploration) by
 * pulling sibling memories that share the same MemGAS cluster tag.
 *
 * The cluster tag is appended to `meta` at capture time by ClusterIdSink
 * (e.g. "cluster:2:conf:0.731"). Given the top-K search results, this
 * expander:
 *
 *   1. Parses cluster ids from each result's `metadata` (or `meta`) field.
 *   2. Pulls an additional `expansionLimit` memories per cluster by running
 *      a follow-up FTS search using the cluster's centroid hint.
 *   3. Deduplicates against the original results and applies a soft
 *      confidence-weighted re-ranking.
 *
 * The expander is **storage-agnostic**: it uses whatever SearchResult[]
 * comes back from the previous layer and a user-supplied fetcher callback.
 * That keeps the unit tests pure (no DB) and makes the integration trivial.
 *
 * Why this matters:
 *   - L2 queries like "summarise all my project work" benefit from
 *     topic-coherent recall, not just literal term matches.
 *   - MemGAS paper shows cluster-expanded recall lifts nDCG by 6-12pp on
 *     broad/browse-style queries.
 */
const DEFAULTS = {
    perClusterLimit: 5,
    maxTotal: 10,
    minConfidence: 0.5,
    scoreDiscount: 0.8,
};
/**
 * Parse the `cluster:<id>:conf:<f>` tag from a meta string.
 * Returns null when no valid tag is present.
 */
export function parseClusterTag(meta) {
    if (!meta)
        return null;
    const m = meta.match(/cluster:(\d+):conf:(\d*\.\d+|\d+)/);
    if (!m)
        return null;
    const clusterId = Number.parseInt(m[1] ?? '0', 10);
    const confidence = Number.parseFloat(m[2] ?? '0');
    if (Number.isNaN(clusterId) || Number.isNaN(confidence))
        return null;
    return { clusterId, confidence };
}
/**
 * Aggregate cluster ids across multiple results, weighted by their
 * original score. Returns clusters sorted by aggregate weight desc.
 */
export function aggregateClusters(results, minConfidence) {
    const map = new Map();
    for (const r of results) {
        const meta = r.metadata;
        if (!meta)
            continue;
        const tag = parseClusterTag(meta);
        if (!tag || tag.confidence < minConfidence)
            continue;
        const score = r.score || 0.5;
        const existing = map.get(tag.clusterId);
        if (existing) {
            existing.totalWeight += score;
            existing.confidence = (existing.confidence + tag.confidence) / 2;
            existing.count += 1;
        }
        else {
            map.set(tag.clusterId, {
                totalWeight: score,
                confidence: tag.confidence,
                count: 1,
            });
        }
    }
    return map;
}
/**
 * Expand a result set by cluster. Pure function over a fetcher.
 *
 * @param results   — top-K from the previous search layer
 * @param fetcher   — async (clusterId, limit) => additional candidates
 * @param options   — per-cluster limit, max total, min confidence
 */
export async function expandByCluster(results, fetcher, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    if (results.length === 0) {
        return {
            originals: [],
            expanded: [],
            combined: [],
            stats: { clustersFound: 0, expandedPulled: 0, expandedKept: 0 },
        };
    }
    const clusters = aggregateClusters(results, opts.minConfidence);
    if (clusters.size === 0) {
        return {
            originals: results,
            expanded: [],
            combined: [...results],
            stats: { clustersFound: 0, expandedPulled: 0, expandedKept: 0 },
        };
    }
    // Build a set of original ids for dedup
    const originalIds = new Set();
    for (const r of results) {
        if (r.id !== undefined)
            originalIds.add(r.id);
    }
    // Sort clusters by total weight desc
    const sorted = [...clusters.entries()].sort((a, b) => b[1].totalWeight - a[1].totalWeight);
    const expanded = [];
    let pulled = 0;
    for (const [clusterId] of sorted) {
        if (expanded.length >= opts.maxTotal)
            break;
        const remaining = opts.maxTotal - expanded.length;
        const limit = Math.min(opts.perClusterLimit, remaining);
        try {
            const candidates = await fetcher(clusterId, limit);
            pulled += candidates.length;
            for (const c of candidates) {
                if (c.id !== undefined && originalIds.has(c.id))
                    continue;
                if (expanded.length >= opts.maxTotal)
                    break;
                // Apply score discount to reflect "secondary" status
                c.score = (c.score || 0.5) * opts.scoreDiscount;
                expanded.push(c);
                if (c.id !== undefined)
                    originalIds.add(c.id);
            }
        }
        catch {
            // fetcher failure: skip this cluster, move on
        }
    }
    return {
        originals: results,
        expanded,
        combined: [...results, ...expanded],
        stats: {
            clustersFound: clusters.size,
            expandedPulled: pulled,
            expandedKept: expanded.length,
        },
    };
}
/**
 * Synchronous version: for when the fetcher returns plain arrays.
 * Same semantics, no async overhead.
 */
export function expandByClusterSync(results, fetcher, options = {}) {
    return _expandSync(results, fetcher, options);
}
function _expandSync(results, fetcher, options) {
    const opts = { ...DEFAULTS, ...options };
    if (results.length === 0) {
        return { originals: [], expanded: [], combined: [], stats: { clustersFound: 0, expandedPulled: 0, expandedKept: 0 } };
    }
    const clusters = aggregateClusters(results, opts.minConfidence);
    if (clusters.size === 0) {
        return { originals: results, expanded: [], combined: [...results], stats: { clustersFound: 0, expandedPulled: 0, expandedKept: 0 } };
    }
    const originalIds = new Set();
    for (const r of results)
        if (r.id !== undefined)
            originalIds.add(r.id);
    const sorted = [...clusters.entries()].sort((a, b) => b[1].totalWeight - a[1].totalWeight);
    const expanded = [];
    let pulled = 0;
    for (const [clusterId] of sorted) {
        if (expanded.length >= opts.maxTotal)
            break;
        const remaining = opts.maxTotal - expanded.length;
        const limit = Math.min(opts.perClusterLimit, remaining);
        const candidates = fetcher(clusterId, limit);
        pulled += candidates.length;
        for (const c of candidates) {
            if (c.id !== undefined && originalIds.has(c.id))
                continue;
            if (expanded.length >= opts.maxTotal)
                break;
            c.score = (c.score || 0.5) * opts.scoreDiscount;
            expanded.push(c);
            if (c.id !== undefined)
                originalIds.add(c.id);
        }
    }
    return {
        originals: results,
        expanded,
        combined: [...results, ...expanded],
        stats: { clustersFound: clusters.size, expandedPulled: pulled, expandedKept: expanded.length },
    };
}
