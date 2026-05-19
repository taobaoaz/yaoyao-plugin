/**
 * hooks/recall-postprocess.ts — Recall post-processing pipeline.
 *
 * Encapsulates scoring, diversity, confidence, filtering, caching, stats.
 */
import type { SearchResult } from "../utils/db-bridge.ts";
import type { AuditLog } from "../utils/audit-log.ts";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.ts";
import { RetrievalStatsCollector } from "../utils/retrieval-stats.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { classifyIntent, INTENT_WEIGHTS } from "../core/search/intent.ts";
import type { RecallThresholds } from "./recall-config.ts";
import {
  applyTimeDecay,
  applyScoring,
  applyDiversitySampling,
  applyMmrDiversity,
  filterByScope,
  accumulateKeywords,
  runRecallFilter,
  checkRepeatQuery,
  recordRecentQuery,
} from "./recall-utils.ts";
import { buildRecallContext, buildHookResult, makeSimpleTrace } from "./recall-formatter.ts";
import type { SimpleScopeManager } from "../utils/scope-manager.ts";

export interface PostProcessConfig extends RecallThresholds {
  enableIntentDriven: boolean;
  enableMmr: boolean;
  mmrLambda: number;
}

export async function doPostProcess(
  results: SearchResult[],
  mode: string,
  userText: string,
  cfg: PostProcessConfig,
  scopeManager: SimpleScopeManager | undefined,
  agentId: string | undefined,
  intent: ReturnType<typeof classifyIntent> | undefined,
  resultCache: SimpleLRU<string, SearchResult[]>,
  stats: RetrievalStatsCollector,
  startMs: number,
  audit: AuditLog | undefined,
  sessionKey: string,
  logger: { debug?: (msg: string) => void; error?: (msg: string) => void },
): Promise<unknown | undefined> {
  let processed = filterByScope(results, scopeManager, agentId);
  processed = applyTimeDecay(processed, cfg.halfLife, cfg.decayMode);
  processed = applyScoring(processed, userText);
  processed.sort((a, b) => b.score - a.score);

  if (cfg.enableIntentDriven && intent) {
    const weights = INTENT_WEIGHTS[intent];
    for (const r of processed) {
      const vecScore = typeof (r as unknown as { vectorScore?: number }).vectorScore === "number"
        ? (r as unknown as { vectorScore: number }).vectorScore
        : r.score;
      const ts = (r as unknown as { timestamp?: number }).timestamp;
      const tempScore = ts ? Math.pow(0.5, (Date.now() - ts) / (30 * 24 * 60 * 60 * 1000)) : 0.5;
      r.score = weights.fts * r.score + weights.vector * vecScore + weights.temporal * tempScore;
    }
    processed.sort((a, b) => b.score - a.score);
  }

  if (cfg.enableMmr) {
    processed = applyMmrDiversity(processed, cfg.mmrLambda, cfg.maxResults);
  } else {
    processed = applyDiversitySampling(processed, cfg.jaccardBase, cfg.jaccardMin);
  }
  const limited = processed.slice(0, cfg.maxResults);

  const confidence = scoreConfidenceSupport(userText, userText);
  if (confidence.score < cfg.scoreThreshold) {
    logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}`);
    return;
  }

  const filtered = await runRecallFilter(limited, userText, cfg);

  const recentQueries: Array<{ query: string; maxResults: number; minScore: number; hitCount: number }> = [];
  const repeatNote = checkRepeatQuery(userText, cfg.maxResults, cfg.scoreThreshold, recentQueries);
  if (repeatNote) {
    logger.debug?.(`[yaoyao-memory:recall] ${repeatNote}`);
  }
  recordRecentQuery(userText, cfg.maxResults, cfg.scoreThreshold, filtered.length, recentQueries);

  accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);

  resultCache.set(`${agentId || "default"}:${userText.slice(0, 120)}`, filtered);
  stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, filtered.length));

  if (audit && filtered.length > 0) {
    audit.record("recall", {
      query: userText, agentId, mode, results: filtered.length,
      durationMs: Date.now() - startMs, ...(repeatNote ? { repeatNote } : {}),
    });
  }

  if (filtered.length > 0) {
    return buildHookResult(buildRecallContext(filtered, cfg.maxContextChars), cfg.position);
  }
}
