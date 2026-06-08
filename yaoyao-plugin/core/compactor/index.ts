/**
 * Memory Compactor — Progressive Summarization (Text-Only)
 * 从 Brain (memory-lancedb-pro) 学习：合并相似记忆，去重降噪
 * 零向量依赖，纯文本 + 启发式相似度
 */

export interface CompactableEntry {
  id: string;
  text: string;
  category: string;
  importance: number;
  timestamp: number;
  scope: string;
  metadata?: string;
}

export interface TextCluster {
  members: CompactableEntry[];
  merged: {
    text: string;
    importance: number;
    category: string;
    scope: string;
    metadata: string;
  };
}

import { jaccardSimilarity } from './similarity.ts';
import { buildMergedEntry } from './merge.ts';

export { jaccardSimilarity, buildMergedEntry };

/**
 * Build clusters using greedy Jaccard expansion.
 * Sort entries by importance DESC so the most valuable memory seeds each cluster.
 */
export function buildTextClusters(
  entries: CompactableEntry[],
  threshold: number,
  minClusterSize: number,
): TextCluster[] {
  if (entries.length < minClusterSize) return [];

  const order = entries
    .map((_, i) => i)
    .sort((a, b) => entries[b].importance - entries[a].importance);

  const assigned = new Uint8Array(entries.length);
  const clusters: TextCluster[] = [];

  for (const seedIdx of order) {
    if (assigned[seedIdx]) continue;

    const cluster: CompactableEntry[] = [entries[seedIdx]];
    assigned[seedIdx] = 1;

    for (let j = 0; j < entries.length; j++) {
      if (assigned[j]) continue;
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

export interface CompactionConfig {
  enabled: boolean;
  minAgeDays: number;
  similarityThreshold: number;
  minClusterSize: number;
  maxEntriesToScan: number;
  dryRun: boolean;
}

export interface CompactionResult {
  scanned: number;
  clustersFound: number;
  entriesDeleted: number;
  entriesCreated: number;
  dryRun: boolean;
}

/**
 * Run a single compaction pass over entries.
 * Pure text version — no embeddings, no vectors.
 */
export function runTextCompaction(
  entries: CompactableEntry[],
  config: CompactionConfig,
): CompactionResult {
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
