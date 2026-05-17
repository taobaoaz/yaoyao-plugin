/**
 * Memory Compactor — Progressive Summarization (Text-Only)
 * 从 Brain (memory-lancedb-pro) 学习：合并相似记忆，去重降噪
 * 零向量依赖，纯文本 + 启发式相似度
 */
/**
 * Compute Jaccard similarity between two texts (word-level).
 * Pure text fallback when vectors are unavailable.
 */
export function jaccardSimilarity(a, b) {
    const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (setA.size === 0 || setB.size === 0)
        return 0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
}
/**
 * Build clusters using greedy Jaccard expansion.
 * Sort entries by importance DESC so the most valuable memory seeds each cluster.
 */
export function buildTextClusters(entries, threshold, minClusterSize) {
    if (entries.length < minClusterSize)
        return [];
    // Sort indices by importance desc (highest importance seeds first)
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
 * Merge a cluster of entries into a single proposed entry.
 *
 * Text strategy: deduplicate lines across all member texts, join with newline.
 * Importance: max across cluster (never downgrade).
 * Category: plurality vote; ties broken by member with highest importance.
 * Scope: use the first (all should match).
 */
export function buildMergedEntry(members) {
    // --- text: deduplicate lines ---
    const seen = new Set();
    const lines = [];
    for (const m of members) {
        for (const line of m.text.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !seen.has(trimmed.toLowerCase())) {
                seen.add(trimmed.toLowerCase());
                lines.push(trimmed);
            }
        }
    }
    const text = lines.join("\n");
    // --- importance: max ---
    const importance = Math.min(1.0, Math.max(...members.map(m => m.importance)));
    // --- category: plurality vote ---
    const counts = new Map();
    for (const m of members) {
        counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    }
    let category = "other";
    let best = 0;
    for (const [cat, count] of counts) {
        if (count > best) {
            best = count;
            category = cat;
        }
    }
    // --- scope: use the first (all should match) ---
    const scope = members[0]?.scope ?? "default";
    // --- metadata ---
    const metadata = JSON.stringify({
        compacted: true,
        sourceCount: members.length,
        compactedAt: Date.now(),
    });
    return { text, importance, category, scope, metadata };
}
/**
 * Run a single compaction pass over entries.
 * Pure text version — no embeddings, no vectors.
 */
export function runTextCompaction(entries, config) {
    if (!config.enabled || entries.length === 0) {
        return { scanned: 0, clustersFound: 0, entriesDeleted: 0, entriesCreated: 0, dryRun: config.dryRun };
    }
    const cutoff = Date.now() - config.minAgeDays * 24 * 60 * 60 * 1000;
    const oldEntries = entries
        .filter(e => e.timestamp < cutoff)
        .slice(0, config.maxEntriesToScan);
    if (oldEntries.length === 0) {
        return { scanned: 0, clustersFound: 0, entriesDeleted: 0, entriesCreated: 0, dryRun: config.dryRun };
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
    // Return compaction plan (caller decides actual delete/store)
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
