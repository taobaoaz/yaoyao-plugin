/**
 * hooks/auto-recall.ts — Auto-recall orchestrator.
 *
 * Uses api.on("before_prompt_build", ...) to inject relevant memories
 * into the prompt context via FTS5 + optional vector search.
 *
 * v1.7.0:
 *   - Per-agent overrides (maxResults, scoreThreshold, queryPrefix, etc.)
 *   - Intent-driven search strategy (auto-classifies query, applies weights)
 *   - Query prefix enhancement (like MemOS queryPrefix)
 *   - Secondary model-based recall filtering (like MemOS recallFilter)
 *   - Configurable maxContextChars for injection budget
 *
 * Scoring, config, and session tracking are in sibling modules:
 *   recall-config.ts   — config type + extraction + per-agent merge
 *   recall-scoring.ts  — time decay, diversity, normalization
 *   recall-session.ts  — keyword accumulation
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import { RetrievalStatsCollector, globalRetrievalStats } from "../utils/retrieval-stats.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { expandQuery } from "../utils/query-expander.ts";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.ts";
import { SimpleLRU } from "../utils/simple-lru.ts";
import { isTrivial } from "../core/filter/trivial.ts";
import { classifyIntent, INTENT_WEIGHTS } from "../core/search/intent.ts";
import type { AuditLog } from "../utils/audit-log.ts";

import { getRecallConfig, applyAgentOverrides, type RecallThresholds } from "./recall-config.ts";
import {
  applyTimeDecay,
  applyScoring,
  applyDiversitySampling,
  filterByScope,
} from "./recall-scoring.ts";
import { accumulateKeywords } from "./recall-session.ts";

export interface RecallHookHandle {
  unregister: () => void;
}

// ── Context formatting ──

function buildRecallContext(results: SearchResult[], maxChars = 1200): string {
  let body = "💡 相关记忆:";
  let used = 0;
  for (const r of results) {
    const line = `\n- ${r.date || ""}: ${r.snippet}`;
    if (used + line.length > maxChars) break;
    body += line;
    used += line.length;
  }
  return used > 0 ? body : "";
}

function buildHookResult(context: string, position: "append" | "prepend"): unknown {
  return position === "prepend" ? { prepend: context } : { append: context };
}

function makeSimpleTrace(query: string, mode: string, startMs: number, inputCount: number, outputCount: number) {
  const totalMs = Date.now() - startMs;
  return {
    query,
    mode: mode as "hybrid" | "fts" | "intent-driven",
    startedAt: startMs,
    stages: [{ name: "recall", inputCount, outputCount, droppedIds: [], scoreRange: null, durationMs: totalMs }],
    finalCount: outputCount,
    totalMs,
  };
}

// ── Model-based recall filter (like MemOS recallFilterEnabled) ──

interface FilterCandidate {
  content: string;
  keep: boolean;
}

async function runRecallFilter(
  candidates: SearchResult[],
  query: string,
  cfg: RecallThresholds,
): Promise<SearchResult[]> {
  if (!cfg.enableRecallFilter || !cfg.recallFilterModel || !cfg.recallFilterBaseUrl) {
    return candidates;
  }
  if (candidates.length === 0) return candidates;

  try {
    // Build a compact prompt that asks the model to classify each item
    const items = candidates.map((c, i) => `[${i}] ${(c.snippet || "").slice(0, cfg.recallFilterMaxItemChars)}`).join("\n");
    const prompt = `Given this user query: "${query.slice(0, 200)}"

Evaluate each memory item below. Respond with indices of items that are RELEVANT and USEFUL.
If none are relevant, respond with "[]".

Items:\n${items}\n\nRelevant indices: [`;

    const response = await fetch(cfg.recallFilterBaseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.recallFilterApiKey ? { "Authorization": `Bearer ${cfg.recallFilterApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.recallFilterModel,
        messages: [
          { role: "system", content: "You are a relevance filter. Only keep items directly answering the query. Return indices as comma-separated numbers inside brackets." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 128,
      }),
      signal: AbortSignal.timeout(cfg.recallFilterTimeoutMs),
    });

    if (!response.ok) {
      if (cfg.recallFilterFailOpen) return candidates;
      return [];
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content || "";
    // Parse indices like [0, 2, 5] or 0, 2, 5
    const indices: number[] = [];
    const match = text.match(/\[(.*?)\]/);
    const raw = match ? match[1] : text;
    for (const part of raw.split(",")) {
      const idx = parseInt(part.trim(), 10);
      if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
        indices.push(idx);
      }
    }

    if (indices.length === 0 && cfg.recallFilterFailOpen) return candidates;
    return indices.map(i => candidates[i]);
  } catch (err) {
    if (cfg.recallFilterFailOpen) return candidates;
    return [];
  }
}

// ── Main hook registration ──

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  audit?: AuditLog,
): RecallHookHandle {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);

  const baseCfg = getRecallConfig(config);
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  // Brain-style LRU result cache
  const resultCache = new SimpleLRU<string, SearchResult[]>({
    maxSize: baseCfg.maxCacheSize,
    ttlMs: baseCfg.cacheTTL,
  });
  const stats = globalRetrievalStats;

  const handler = async (event: unknown, ctx: unknown) => {
    const recallAsync = async () => {
      try {
        const startMs = Date.now();
        const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
        if (!sessionFilter.shouldProcess(sessionKey)) return;

        const agentId = (ctx as Record<string, unknown>).agentId as string | undefined;

        // Apply per-agent overrides
        const cfg = applyAgentOverrides(baseCfg, agentId);

        const e = event as Record<string, unknown>;
        const userMessage = e?.message || e?.prompt;
        if (!userMessage || isTrivial(userMessage as string)) return;

        const userText = String(userMessage);

        // LRU cache hit (include agentId in cache key)
        const cacheKey = `${agentId || "default"}:${userText.slice(0, 120)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
          if (cached.length > 0) return buildHookResult(buildRecallContext(cached, cfg.maxContextChars), cfg.position);
          return;
        }

        // Query prefix enhancement (like MemOS queryPrefix)
        // If queryPrefix is set, prepend it to guide memory search semantics
        const prefixedQuery = cfg.queryPrefix ? `${cfg.queryPrefix} ${userText}` : userText;

        // Query expansion
        const expandedQuery = expandQuery(prefixedQuery);
        const primaryQuery = expandedQuery || prefixedQuery;

        // Intent classification for logging (no behavioral change for base search)
        const intent = cfg.enableIntentDriven ? classifyIntent(userText) : undefined;

        // ── Search: intent-driven | vector hybrid | pure FTS ──
        let results: SearchResult[] = [];
        let mode = "fts";

        if (cfg.enableIntentDriven && embedding?.isAvailable) {
          // Intent-driven: overfetch + intent-weighted re-rank
          mode = "intent-driven";
          const overfetchLimit = cfg.maxResults * 4;
          try {
            const queryVec = await embedding.embed(primaryQuery);
            const vectorResults = db.vectorSearch(queryVec, overfetchLimit);
            if (vectorResults && vectorResults.length > 0) {
              results = vectorResults.map(r => ({
                ...r,
                score: r.vectorScore ?? r.score ?? 0.5,
              }));
            }
            // Also search FTS for lexical matches
            const ftsResults = db.search(primaryQuery, overfetchLimit);
            for (const f of ftsResults) {
              const exists = results.some(r => r.id === f.id);
              if (!exists) results.push({ ...f, score: f.score ?? 0.3 });
            }
          } catch {
            // Fallback to FTS
            results = db.search(primaryQuery, cfg.maxResults * 2).map(r => ({ ...r, score: r.score ?? 0.5 }));
            mode = "fts";
          }
        } else if (embedding?.isAvailable) {
          mode = "hybrid";
          try {
            const userEmbedding = await embedding.embed(primaryQuery);
            const vectorResults = db.vectorSearch(userEmbedding, cfg.maxResults * 2);
            if (vectorResults && vectorResults.length > 0) {
              results = vectorResults.map((r) => ({
                ...r,
                score: r.vectorScore ?? r.score ?? 0.5,
              }));
            }
          } catch (vecErr) {
            api.logger.warn?.(`[yaoyao-memory:recall] Vector search failed, falling back to FTS5: ${(vecErr as Error).message}`);
          }
        }

        if (results.length === 0) {
          const ftsResults = db.search(primaryQuery, cfg.maxResults * 2);
          results = ftsResults.map((r) => ({ ...r, score: r.score ?? 0.5 }));
          mode = "fts";
        }

        // ── Post-processing pipeline ──
        let processed = filterByScope(results, scopeManager, agentId);
        processed = applyTimeDecay(processed, cfg.halfLife, cfg.decayMode);
        processed = applyScoring(processed, userText);
        processed.sort((a, b) => b.score - a.score);

        // Apply intent-aware re-ranking if intent-driven mode
        if (cfg.enableIntentDriven && intent) {
          const weights = INTENT_WEIGHTS[intent];
          for (const r of processed) {
            // Boost vector score, time-decay the rest
            const vecScore = typeof (r as unknown as { vectorScore?: number }).vectorScore === "number"
              ? (r as unknown as { vectorScore: number }).vectorScore
              : r.score;
            // Temporal score from timestamp if available
            const ts = (r as unknown as { timestamp?: number }).timestamp;
            const tempScore = ts ? Math.pow(0.5, (Date.now() - ts) / (30 * 24 * 60 * 60 * 1000)) : 0.5;
            // Re-score with intent weights
            r.score = weights.fts * r.score + weights.vector * vecScore + weights.temporal * tempScore;
          }
          processed.sort((a, b) => b.score - a.score);
        }

        processed = applyDiversitySampling(processed, cfg.jaccardBase, cfg.jaccardMin);
        const limited = processed.slice(0, cfg.maxResults);

        // Confidence threshold
        const confidence = scoreConfidenceSupport(userText, userText);
        if (confidence.score < cfg.scoreThreshold) {
          api.logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}`);
          return;
        }

        // ── Model-based recall filter (secondary pass) ──
        const filtered = await runRecallFilter(limited, userText, cfg);

        // Session keyword accumulation
        accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);

        // Cache + stats
        resultCache.set(cacheKey, filtered);
        stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, filtered.length));

        if (audit && filtered.length > 0) {
          audit.record("recall", { query: userText, agentId, mode, results: filtered.length, durationMs: Date.now() - startMs });
        }

        if (filtered.length > 0) {
          return buildHookResult(buildRecallContext(filtered, cfg.maxContextChars), cfg.position);
        }
      } catch (err) {
        api.logger.error?.(`[yaoyao-memory:recall] Hook error: ${(err as Error).message}`);
      }
    };

    // Timeout guard
    try {
      await Promise.race([
        recallAsync(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("recall timeout")), baseCfg.timeoutMs)),
      ]);
    } catch (timeoutErr) {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${baseCfg.timeoutMs}ms, skipping`);
    }
  };

  api.on("before_prompt_build", handler);

  return {
    unregister: () => {
      (api as unknown as { off?: (event: string, handler: unknown) => void }).off?.("before_prompt_build", handler);
    },
  };
}
