/**
 * Memory Compactor — Progressive Summarization (Text-Only)
 * 从 Brain (memory-lancedb-pro) 学习：合并相似记忆，去重降噪
 * 零向量依赖，纯文本 + 启发式相似度
 */
import { jaccardSimilarity } from "./similarity.js";
import { buildMergedEntry } from "./merge.js";
export { jaccardSimilarity, buildMergedEntry };
/**
 * Build clusters using greedy Jaccard expansion.
 * Sort entries by importance DESC so the most valuable memory seeds each cluster.
 */
export function buildTextClusters(entries, threshold, minClusterSize) {
    if (entries.length < minClusterSize)
        return [];
    const order = entries
        .map((_, i) => i)
        .sort((a, b) => entries[b].importance - entries[a].importance);
    const assigned = new Uint8Array(entries.length);
    const clusters = [];
    for (const seedIdx of order) {
        if (assigned[seedIdx])
            continue;
        const cluster = [entries[seedIdx]];
        assigned[seedIdx] = 1;
        for (let j = 0; j < entries.length; j++) {
            if (assigned[j])
                continue;
            if (jaccardSimilarity(entries[seedIdx].text, entries[j].text) >= threshold) {
                cluster.push(entries[j]);
                assigned[j] = 1;
            }
        }
        if (cluster.length >= minClusterSize) {
            clusters.push({
                members: cluster,
                merged: buildMergedEntry(cluster),
            });
        }
    }
    return clusters;
}
/**
 * Run a single compaction pass over entries.
 * Pure text version — no embeddings, no vectors.
 */
export function runTextCompaction(entries, config) {
    if (!config.enabled || entries.length === 0) {
        return {
            scanned: 0,
            clustersFound: 0,
            entriesDeleted: 0,
            entriesCreated: 0,
            dryRun: config.dryRun,
        };
    }
    const cutoff = Date.now() - config.minAgeDays * 24 * 60 * 60 * 1000;
    const oldEntries = entries.filter((e) => e.timestamp < cutoff).slice(0, config.maxEntriesToScan);
    if (oldEntries.length === 0) {
        return {
            scanned: 0,
            clustersFound: 0,
            entriesDeleted: 0,
            entriesCreated: 0,
            dryRun: config.dryRun,
        };
    }
    const clusters = buildTextClusters(oldEntries, config.similarityThreshold, config.minClusterSize);
    if (config.dryRun) {
        return {
            scanned: oldEntries.length,
            clustersFound: clusters.length,
            entriesDeleted: 0,
            entriesCreated: 0,
            dryRun: true,
        };
    }
    let entriesDeleted = 0;
    let entriesCreated = 0;
    for (const cluster of clusters) {
        entriesDeleted += cluster.members.length;
        entriesCreated += 1;
    }
    return {
        scanned: oldEntries.length,
        clustersFound: clusters.length,
        entriesDeleted,
        entriesCreated,
        dryRun: false,
    };
}
