/**
 * hooks/recall-parallel.ts — Parallel claw-core + local recall search with smart merge.
 *
 * Encapsulates the coexist-mode parallel search and deduplication merge.
 * Pure function — all dependencies passed as parameters.
 */

import type { ClawBridge } from '../utils/claw-bridge.ts';
import type { DBBridge, SearchResult } from '../utils/db-bridge.ts';
import type { EmbeddingService } from '../utils/embedding.ts';
import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';
import { doRecallSearch, type RecallSearchConfig } from './recall-search.ts';

export interface ParallelRecallResult {
  results: SearchResult[];
  mode: string;
  source: string; // "local" | "merged" | "claw"
}

/** Run parallel claw-core + local search, merge and dedupe. */
export async function doParallelRecall(
  db: DBBridge,
  userText: string,
  primaryQuery: string,
  searchCfg: RecallSearchConfig,
  maxResults: number,
  embedding: EmbeddingService | null,
  clawBridge: ClawBridge | null,
  apiLogger: PluginLogger,
): Promise<ParallelRecallResult> {
  if (!clawBridge) {
    const localRes = await doRecallSearch(db, primaryQuery, searchCfg, embedding, apiLogger);
    return { results: localRes.results.slice(0, maxResults), mode: localRes.mode, source: 'local' };
  }

  // Parallel: local + claw-core
  const [localRes, clawRes] = await Promise.allSettled([
    doRecallSearch(db, primaryQuery, searchCfg, embedding, apiLogger),
    Promise.race([
      clawBridge.recall(userText, maxResults * 2),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('claw timeout')), 5000)),
    ]),
  ]);

  let localResults: SearchResult[] = [];
  let mode = 'fts';

  if (localRes.status === 'fulfilled') {
    localResults = localRes.value.results;
    mode = localRes.value.mode;
  }

  let clawResults: SearchResult[] = [];
  if (clawRes.status === 'fulfilled' && clawRes.value) {
    const raw = clawRes.value;
    if (raw.memories) {
      clawResults = raw.memories.map(
        (m: { content: string; confidence: number; source: string }, i: number) => ({
          id: i,
          filename: '',
          snippet: m.content,
          score: m.confidence,
          date: new Date().toISOString().slice(0, 10),
          metadata: JSON.stringify({ source: m.source, claw_verified: raw.verified ?? false }),
        }),
      );
    }
    apiLogger.debug?.(`[yaoyao-memory:recall] claw-core returned ${clawResults.length} memories`);
  } else {
    const reason = clawRes.status === 'rejected' ? String(clawRes.reason) : 'empty';
    apiLogger.debug?.(`[yaoyao-memory:recall] claw-core recall failed: ${reason}`);
  }

  if (clawResults.length === 0) {
    return { results: localResults.slice(0, maxResults), mode, source: 'local' };
  }

  // Smart merge: dedupe by content hash, prefer claw-core (already sorted by score)
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of [...clawResults, ...localResults]) {
    const key = r.snippet.slice(0, 200);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }
  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const results = merged.slice(0, maxResults);
  apiLogger.debug?.(
    `[yaoyao-memory:recall] merged ${clawResults.length}+${localResults.length} → ${results.length}`,
  );

  return { results, mode, source: 'merged' };
}
