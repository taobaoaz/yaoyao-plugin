/**
 * auto-recall hook - injects relevant memories into the prompt context.
 *
 * Uses api.on("before_prompt_build", ...) to search memory via FTS5
 * and optionally sqlite-vec for semantic similarity search.
 *
 * Enhancements:
 * 1. Time decay scoring (configurable half-life)
 * 2. Diversity sampling (configurable Jaccard threshold)
 * 3. Session context accumulation (configurable max keywords)
 *
 * v1.5.0+: Removed L4 feedback tracking and persona state injection.
 *          Feedback learning moved to yaoyao-soul.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { DBBridge, SearchResult } from "../utils/db-bridge.ts";
import type { EmbeddingService } from "../utils/embedding.ts";
import { detectSentiment } from "../utils/sentiment.ts";
import { RetrievalStatsCollector } from "../utils/retrieval-stats.ts";
import { computeReflectionLogistic, computePresetReflectionScore } from "../utils/reflection-ranking.ts";
import { parseAccessMetadata, buildUpdatedMetadata, computeEffectiveHalfLife } from "../utils/access-tracker.ts";
import { analyzeIntent, applyCategoryBoost } from "../utils/intent-analyzer.ts";
import { scoreConfidenceSupport } from "../utils/confidence-scorer.ts";
import { parseSupportInfo, type SupportInfoV2 } from "../utils/support-info.ts";


import type { AuditLog } from "../utils/audit-log.ts";

// ── Configurable thresholds (read from plugin config) ──
interface RecallThresholds {
  cacheTTL: number;
  maxCacheSize: number;
  halfLife: number;
  jaccardBase: number;
  jaccardMin: number;
  maxSessions: number;
  maxContextKeywords: number;
  maxResults: number;
  decayMode: "weibull" | "logistic";
  /** Recall position: "append" = after system prompt (default), "prepend" = before user message (cache-friendly) */
  position: "append" | "prepend";
  /** Max recall time in ms before skipping injection without blocking */
  timeoutMs: number;
  /** Exclude memories created within this many ms ago (0 = disabled). Prevents circular recall. */
  excludeRecentMS: number;
  /** Minimum results to inject. If search returns fewer, fallback to latest memories. */
  minResults: number;
  /** Max characters for injected recall text (0 = unlimited). */
  maxChars: number;
}

import { clampNum } from "../utils/clamp.ts";

import { getBool, getProp } from "../utils/config.ts";

// ── Config helper: read from flat config keys with range clamping ──
function cfgVal(config: YaoyaoMemoryConfig, key: string, defaultVal: number, min: number, max: number): number {
  return clampNum(getProp(config, key, defaultVal), defaultVal, min, max);
}

function getRecallConfig(config: YaoyaoMemoryConfig): RecallThresholds {
  return {
    cacheTTL: cfgVal(config, "recallCacheTTL", 30_000, 5_000, 300_000),
    maxCacheSize: cfgVal(config, "recallMaxCacheSize", 50, 10, 200),
    halfLife: cfgVal(config, "recallHalfLife", 30, 1, 365),
    jaccardBase: cfgVal(config, "recallJaccardBase", 0.75, 0.1, 1),
    jaccardMin: cfgVal(config, "recallJaccardMin", 0.5, 0.1, 1),
    maxSessions: cfgVal(config, "recallMaxSessions", 1000, 100, 5000),
    maxContextKeywords: cfgVal(config, "recallMaxContextKeywords", 20, 5, 100),
    maxResults: clampNum(config.recall?.maxResults, 3, 1, 20),
    decayMode: (config.recall?.decayMode as "weibull" | "logistic") ?? "weibull",
    position: (config.recall?.position as "append" | "prepend") ?? "append",
    timeoutMs: clampNum(config.recall?.timeoutMs, 5000, 500, 30000),
    excludeRecentMS: clampNum(config.recall?.excludeRecentMS, 0, 0, 60000),
    minResults: clampNum(config.recall?.minResults, 0, 0, 20),
    maxChars: clampNum(config.recall?.maxChars, 0, 0, 8000),
    scoreThreshold: clampNum(config.recall?.scoreThreshold, 0, 0, 1),
  };
}

// ── Search result cache (TTL + size limit from config) ──
const resultCache = new Map<string, { results: SearchResult[]; expires: number }>();

/** Periodic expired-entry cleanup counter */
let cacheAccessCount = 0;

function getCachedResults(key: string, cfg: RecallThresholds): SearchResult[] | null {
  if (++cacheAccessCount >= 100) {
    cacheAccessCount = 0;
  }
  const now = Date.now();
  // Periodic expired-entry cleanup (every 100 accesses)
  if (cacheAccessCount === 0) {
    for (const [k, v] of resultCache) {
      if (v.expires < now) resultCache.delete(k);
    }
  }
  const cached = resultCache.get(key);
  if (cached && cached.expires > now) return cached.results;
  resultCache.delete(key);
  return null;
}

function setCachedResults(key: string, results: SearchResult[], cfg: RecallThresholds): void {
  if (resultCache.size >= cfg.maxCacheSize) {
    const now = Date.now();
    // Phase 1: evict expired entries
    for (const [k, v] of resultCache) {
      if (v.expires < now) resultCache.delete(k);
    }
    // Phase 2: if still full, evict oldest by expiration time
    if (resultCache.size >= cfg.maxCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of resultCache) {
        if (v.expires < oldestTime) {
          oldestTime = v.expires;
          oldestKey = k;
        }
      }
      if (oldestKey) resultCache.delete(oldestKey);
    }
  }
  resultCache.set(key, { results, expires: Date.now() + cfg.cacheTTL });
}

// ── Enhancement 3: Session context accumulation ──
// Maintains cross-turn keyword context per session to improve recall relevance.
// Entries are LRU-evicted when over maxSessions to prevent memory leaks.
const sessionContext = new Map<string, { keywords: Set<string>; lastAccess: number }>();

function updateSessionContext(sessionKey: string, keywords: string[], cfg: RecallThresholds): void {
  const now = Date.now();
  // Evict oldest session by lastAccess if over limit
  if (!sessionContext.has(sessionKey) && sessionContext.size >= cfg.maxSessions) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of sessionContext) {
      if (v.lastAccess < oldestTime) {
        oldestTime = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey) sessionContext.delete(oldestKey);
  }
  let entry = sessionContext.get(sessionKey);
  if (!entry) {
    entry = { keywords: new Set<string>(), lastAccess: now };
    sessionContext.set(sessionKey, entry);
  }
  entry.lastAccess = now;
  for (const kw of keywords) {
    entry.keywords.add(kw);
  }
  // Evict oldest when over limit
  if (entry.keywords.size > cfg.maxContextKeywords) {
    const arr = Array.from(entry.keywords);
    const toRemove = arr.slice(0, entry.keywords.size - cfg.maxContextKeywords);
    for (const kw of toRemove) entry.keywords.delete(kw);
  }
}

function getSessionContextKeywords(sessionKey: string): string[] {
  const entry = sessionContext.get(sessionKey);
  if (entry) {
    entry.lastAccess = Date.now();
    return Array.from(entry.keywords);
  }
  return [];
}

// ── Enhancement 1: Time decay scoring ──
// Applies time decay with optional logistic curve (Brain-style reflection ranking)
function applyTimeDecay(results: SearchResult[], cfg: RecallThresholds, mode: "weibull" | "logistic" = "weibull"): SearchResult[] {
  if (results.length <= 1) return results;
  const now = Date.now();
  const dayMs = 86400000;

  return results
    .map((r, i) => {
      let daysAgo = 0;
      const dateStr = r.date || r.filename?.replace(".md", "") || "";
      const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const dateObj = new Date(dateMatch[1] + "T00:00:00");
        if (!isNaN(dateObj.getTime())) {
          daysAgo = Math.max(0, (now - dateObj.getTime()) / dayMs);
        }
      }
      const originalScore = typeof r.score === "number" ? r.score : Math.max(0.1, 1.0 - i * 0.1);
      // Brain-style composite decay: recency * frequency * intrinsic
      const accessCount = (r as Record<string, unknown>).accessCount as number || 0;
      const importance = (r as Record<string, unknown>).importance as number || 0.5;
      const tier = ((r as Record<string, unknown>).tier as string) || "active";
      const beta = tier === "core" ? 0.8 : tier === "working" ? 1.0 : 1.3;

      let recency: number;
      if (mode === "logistic") {
        // Brain reflection-ranking: logistic decay with tier-adjusted midpoint
        const midpoint = cfg.halfLife * (tier === "core" ? 2.0 : tier === "working" ? 1.0 : 0.7);
        recency = computeReflectionLogistic(daysAgo, midpoint, 0.15);
      } else {
        // Weibull decay (original yaoyao)
        recency = Math.exp(-Math.pow(daysAgo / cfg.halfLife, beta));
      }

      const frequency = Math.log1p(accessCount) * 0.15 + 1.0;
      const intrinsic = 0.3 + 0.7 * importance;
      return { ...r, score: originalScore * recency * frequency * intrinsic };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ── Brain-style Confidence Scorer ──
function applyConfidenceScoring(results: SearchResult[], userMessage: string): SearchResult[] {
  if (results.length === 0) return results;
  return results.map(r => {
    const breakdown = scoreConfidenceSupport(r.snippet, userMessage);
    // Blend existing score with confidence (0.7 existing + 0.3 confidence)
    const blended = (r.score ?? 0.5) * 0.7 + breakdown.score * 0.3;
    return { ...r, score: blended };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ── Brain-style Length Normalization + Importance Weighting ──
const LENGTH_ANCHOR = 200; // Brain default: 200 chars

function applyLengthNormalization(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const charLen = r.snippet.length;
    if (charLen <= 0) return r;
    const factor = 1 / (1 + 0.5 * Math.log2(Math.max(charLen, 1) / LENGTH_ANCHOR));
    return { ...r, score: (r.score ?? 0) * factor };
  });
}

function applyImportanceWeighting(results: SearchResult[]): SearchResult[] {
  return results.map((r) => {
    const imp = ((r as Record<string, unknown>).importance as number) || 0.5;
    const weight = 0.7 + 0.3 * imp;
    return { ...r, score: (r.score ?? 0) * weight };
  });
}

function applyScoring(results: SearchResult[]): SearchResult[] {
  return applyImportanceWeighting(applyLengthNormalization(results));
}

// ── Enhancement 2: Diversity sampling ──
// Multi-faceted diversity: Jaccard dedup + date coverage + previous recall backoff

function applyDiversitySampling(
  results: SearchResult[],
  maxResults: number = 8,
  cfg: RecallThresholds,
): SearchResult[] {
  if (results.length <= 1) return results;

  /** Adaptive Jaccard threshold — stricter when more results are available */
  const jaccardThreshold = Math.max(
    cfg.jaccardMin,
    cfg.jaccardBase - (results.length / 30) * (cfg.jaccardBase - cfg.jaccardMin),
  );

  function jaccardSimilarity(a: string, b: string): number {
    const snippetA = a.slice(0, 50);
    const snippetB = b.slice(0, 50);
    const tokenize = (s: string): string[] =>
      [...s.toLowerCase().matchAll(/[\w\u4e00-\u9fff]+/g)].map(m => m[0]);
    const setA = new Set<string>(tokenize(snippetA));
    const setB = new Set<string>(tokenize(snippetB));
    const intersect = new Set<string>([...setA].filter((x) => setB.has(x)));
    const union = new Set<string>([...setA, ...setB]);
    return union.size > 0 ? intersect.size / union.size : 0;
  }

  // Phase 1: Jaccard dedup (semantic diversity)
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const isDuplicate = deduped.some((k) => jaccardSimilarity(r.snippet, k.snippet) > jaccardThreshold);
    if (!isDuplicate) deduped.push(r);
  }

  // Phase 2: Date coverage diversity — prefer broader date spread
  if (deduped.length <= maxResults) return deduped;

  const dates = new Map<string, SearchResult[]>();
  for (const r of deduped) {
    const dateKey = (r.date || r.filename?.slice(0, 10) || "unknown").slice(0, 10);
    if (!dates.has(dateKey)) dates.set(dateKey, []);
    dates.get(dateKey)!.push(r);
  }

  // Interleave: pick one from each date group in round-robin, capped at maxResults
  const groups = [...dates.entries()].sort(([a], [b]) => a < b ? 1 : -1); // newer dates first
  const interleaved: SearchResult[] = [];
  let picked = true;
  while (picked && interleaved.length < maxResults) {
    picked = false;
    for (const [, items] of groups) {
      if (items.length > 0 && interleaved.length < maxResults) {
        interleaved.push(items.shift()!);
        picked = true;
      }
    }
  }

  return interleaved;
}

/** Format search results into recall text snippet with sentiment emoji */
function formatRecallText(results: SearchResult[]): string {
  return results
    .map((r) => {
      const mood = detectSentiment(r.snippet);
      // Brain-style support info: parse metadata for confidence badge
      let confidenceBadge = "";
      try {
        const meta = JSON.parse(r.metadata || "{}") as Record<string, unknown>;
        const support = parseSupportInfo(meta.support_info);
        if (support.total_observations > 0) {
          const strengthPct = Math.round(support.global_strength * 100);
          confidenceBadge = ` [置信度${strengthPct}%]`;
        }
      } catch { /* ignore malformed metadata */ }
      return `[${r.filename}] ${mood.emoji}${confidenceBadge}\n${r.snippet}`;
    })
    .join("\n---\n");
}

/** Build the appendSystemContext object for return */
function buildRecallContext(results: SearchResult[], hintText?: string, maxChars?: number): { appendSystemContext: string } | undefined {
  if (results.length === 0) return undefined;
  let recallText = formatRecallText(results);
  if (maxChars && maxChars > 0 && recallText.length > maxChars) {
    // Truncate to nearest separator, append ellipsis
    const idx = recallText.lastIndexOf("\n---\n", maxChars);
    recallText = (idx > 0 ? recallText.slice(0, idx) : recallText.slice(0, maxChars)) + "\n\n...（记忆已截断）";
  }
  const hint = hintText || "以下内容来自你的对话历史记录，可能与当前对话相关";
  return {
    appendSystemContext: `## 相关记忆\n\n${hint}：\n\n${recallText}\n`,
  };
}

/** Build prependSystemContext for static system prompt rules (cached by provider) */
function buildPrependRules(config: YaoyaoMemoryConfig): string | undefined {
  const rules: string[] = [];

  // 多模态记忆指令：开启 autoSaveImage 后，AI 自动将图片理解结果存入记忆
  const autoSaveImage = getBool(config, "autoSaveImage", false);
  if (autoSaveImage) {
    rules.push(
      "## 行为规则\n\n当用户发送图片或你通过任何方式获取到图片内容后，在回复用户之前，请调用 memory_save 工具，以 `[图片] 图片描述` 的格式将图片描述保存到记忆中。图片描述应为简洁的中文完整句子。",
    );
  }

  return rules.length > 0 ? rules.join("\n\n") : undefined;
}

/** Ensure minimum result count by falling back to latest memories. */
function ensureMinResults(results: SearchResult[], db: DBBridge, minResults: number): SearchResult[] {
  if (minResults <= 0 || results.length >= minResults) return results;
  const needed = minResults - results.length;
  try {
    const fallback = db.searchAll(needed);
    // Deduplicate by id
    const seen = new Set(results.map(r => r.id));
    const extra = fallback.filter(r => !seen.has(r.id));
    return results.concat(extra.slice(0, needed));
  } catch {
    return results;
  }
}
function buildHookResult(
  appendCtx: { appendSystemContext: string } | undefined,
  config: YaoyaoMemoryConfig,
  position: "append" | "prepend",
): { prependContext?: string; appendSystemContext?: string; prependSystemContext?: string } | undefined {
  if (!appendCtx) return undefined;

  const staticPrepend = buildPrependRules(config);

  if (position === "prepend") {
    // Tencent-style: inject recall before user message for better prompt cache
    return {
      prependContext: appendCtx.appendSystemContext,
      ...(staticPrepend ? { prependSystemContext: staticPrepend } : {}),
    };
  }

  // Legacy: append after system prompt
  if (!staticPrepend) return appendCtx;
  return {
    prependSystemContext: staticPrepend,
    appendSystemContext: appendCtx?.appendSystemContext || "",
  };
}

/** Brain-style scope filter: only return memories accessible to the current agent */
function filterByScope(
  results: SearchResult[],
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  agentId?: string,
): SearchResult[] {
  if (!scopeManager) return results;
  return results.filter((r) => {
    try {
      const meta = JSON.parse(r.metadata || "{}") as Record<string, unknown>;
      const scope = (meta.scope as string) || "global";
      return scopeManager.isAccessible(scope, agentId);
    } catch {
      return true; // if metadata is malformed, allow it through
    }
  });
}
// Skip retrieval for greetings, commands, simple instructions, and system messages.
// Saves embedding API calls and reduces noise injection.

const CONTROL_PROMPT_SKIP_PATTERNS = [
  /A new session was started via \/new or \/reset/i,
  /Execute your Session Startup sequence now/i,
  /(^|\n)\s*\/note\b/i,
];

const SKIP_PATTERNS = [
  /^(hi|hello|hey|good\s*(morning|afternoon|evening|night)|greetings|yo|sup|howdy|what'?s up)\b/i,
  /^\//,
  /^(run|build|test|ls|cd|git|npm|pip|docker|curl|cat|grep|find|make|sudo)\b/i,
  /^(yes|no|yep|nope|ok|okay|sure|fine|thanks|thank you|thx|ty|got it|understood|cool|nice|great|good|perfect|awesome|👍|👎|✅|❌)\s*[.!?]?$/i,
  /^(go ahead|continue|proceed|do it|start|begin|next|实施|开始|继续|好的|可以|行)\s*[.!?]?$/i,
  /^[\p{Emoji}\s]+$/u,
  /HEARTBEAT/i,
  /^\[System/i,
  /^(ping|pong|test|debug)\s*[.!?]?$/i,
];

const FORCE_RETRIEVE_PATTERNS = [
  /\b(remember|recall|forgot|memory|memories)\b/i,
  /\b(last time|before|previously|earlier|yesterday|ago)\b/i,
  /\b(my (name|email|phone|address|birthday|preference))\b/i,
  /\b(what did (i|we)|did i (tell|say|mention))\b/i,
  /(你记得|你記得|之前|上次|以前|还记得|還記得|提到过|提到過|说过|說過)/i,
];

function normalizeQuery(query: string): string {
  let s = query.trim();
  const metadataPattern = /^(Conversation info|Sender) \(untrusted metadata\):[\s\S]*?\s*$/gim;
  s = s.replace(metadataPattern, '');
  s = s.trim().replace(/^\[cron:[^\]]+\]\s*/i, '');
  s = s.trim().replace(/^\[[A-Za-z]{3}\s\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}\s[^\]]+\]\s*/, '');
  return s.trim();
}

function shouldSkipRetrieval(query: string, minLength?: number): boolean {
  const trimmed = normalizeQuery(query);
  if (CONTROL_PROMPT_SKIP_PATTERNS.some(p => p.test(trimmed))) return true;
  if (FORCE_RETRIEVE_PATTERNS.some(p => p.test(trimmed))) return false;
  if (trimmed.length < 5) return true;
  if (SKIP_PATTERNS.some(p => p.test(trimmed))) return true;
  if (minLength !== undefined && minLength > 0) {
    if (trimmed.length < minLength && !trimmed.includes('?') && !trimmed.includes('？')) return true;
    return false;
  }
  const hasCJK = /[一-鿿぀-ゟ゠-ヿ가-힯]/.test(trimmed);
  const defaultMinLength = hasCJK ? 6 : 15;
  if (trimmed.length < defaultMinLength && !trimmed.includes('?') && !trimmed.includes('？')) return true;
  return false;
}

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: import("../utils/embedding.js").EmbeddingService | null,
  scopeManager?: import("../utils/scope-manager.ts").SimpleScopeManager,
  audit?: AuditLog,
) {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);

  const cfg = getRecallConfig(config);

  // Brain-style retrieval stats: aggregate query metrics
  const stats = globalRetrievalStats;

  function makeSimpleTrace(query: string, mode: string, startMs: number, inputCount: number, outputCount: number) {
    const totalMs = Date.now() - startMs;
    return {
      query,
      mode: mode as "hybrid" | "fts",
      startedAt: startMs,
      stages: [{ name: "recall", inputCount, outputCount, droppedIds: [], scoreRange: null, durationMs: totalMs }],
      finalCount: outputCount,
      totalMs,
    };
  }



  api.on("before_prompt_build", async (event, ctx) => {
    const recallAsync = async () => {
    try {
      const startMs = Date.now();

      // Session filter: skip internal/system sessions
      const sessionKey = (ctx as Record<string, unknown>).sessionKey as string || "default";
      if (!sessionFilter.shouldProcess(sessionKey)) {
        return;
      }

      const e = event as Record<string, unknown>;
      const userMessage = e?.message || e?.prompt;
      if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length < 3) {
        return;
      }

      // Brain-style adaptive retrieval: skip greetings, commands, heartbeat
      if (shouldSkipRetrieval(userMessage)) {
        api.logger.debug?.('[yaoyao-memory:recall] Skipped retrieval (adaptive filter)');
        return;
      }

      // Extract keywords for FTS5 query
      const keywords = extractKeywords(userMessage);
      if (keywords.length === 0) {
        // Fallback: return most recent memory when all input is stopwords
        try {
          const fallback = db.getLatestMemory(1);
          if (fallback.length > 0) {
            api.logger.debug?.("[yaoyao-memory:recall] No keywords, using most recent memory as fallback");
            return buildHookResult(buildRecallContext(fallback, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
          }
        } catch { /* best effort */ }
        return;
      }

      // ── Enrich with session context keywords (cross-turn carry-over) ──
      const ctxKeywords = getSessionContextKeywords(sessionKey);
      const enrichedKeywords = [...keywords];
      for (const kw of ctxKeywords) {
        if (!enrichedKeywords.includes(kw)) {
          enrichedKeywords.push(kw);
        }
      }

      // Brain-style query expansion: expand colloquial terms to technical equivalents
      const rawQuery = enrichedKeywords.join(" ");
      const ftsQuery = expandQuery(rawQuery);

      const maxResults = cfg.maxResults;
      const searchType = embedding ? "hybrid" : "fts";
      const cacheKey = `${searchType}:${ftsQuery}:${maxResults}`;

      // Check cache
      const cached = getCachedResults(cacheKey, cfg);
      if (cached) {
        api.logger.debug?.(`[yaoyao-memory:recall] Cache hit | decay=${decayed.length} | dedup=${deduped.length}`);
        const decayed = applyTimeDecay(cached, cfg, cfg.decayMode);
        const scored = applyScoring(decayed, userMessage);
        const deduped = applyDiversitySampling(scored, maxResults, cfg);
        const ensured = ensureMinResults(deduped, db, cfg.minResults);
        updateSessionContext(sessionKey, keywords, cfg);
        stats.recordQuery(makeSimpleTrace(ftsQuery, searchType, startMs, cached.length, ensured.length));
        return buildHookResult(buildRecallContext(ensured, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
      }

      // Hybrid search: FTS5 + optional vector (RRF fusion)
      if (embedding) {
        try {
          const vec = await embedding.embed(userMessage, embedding.recallTimeoutMs);
          const rawResults = db.rrfHybridSearch
            ? db.rrfHybridSearch(ftsQuery, vec, maxResults * 2, 60).slice(0, maxResults)
            : db.hybridSearch(ftsQuery, vec, maxResults); // fallback for older db bridges
          // Brain-style scope filtering: enforce multi-agent memory isolation
          const agentId = (api as Record<string, unknown>).agentId as string | undefined;
          const results = filterByScope(rawResults, scopeManager, agentId);
          if (results.length < rawResults.length) {
            api.logger.debug?.(`[yaoyao-memory:recall] Scope filter excluded ${rawResults.length - results.length} memories`);
          }
          if (results.length > 0) {
            setCachedResults(cacheKey, results, cfg);
        // Brain-style access tracking: update access count for retrieved memories
        for (const r of results) {
          try {
            const updatedMeta = buildUpdatedMetadata(r.metadata, Date.now());
            if (updatedMeta !== r.metadata) {
              db.updateMetadata(r.id, updatedMeta);
            }
          } catch { /* best effort */ }
        }
            api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets (hybrid) in ${Date.now() - startMs}ms | decay=${decayed.length} | dedup=${deduped.length}`);
            // Apply enhancements
            const decayed = applyTimeDecay(results, cfg, cfg.decayMode);
            const scored = applyScoring(decayed, userMessage);
            const confident = applyConfidenceScoring(scored, userMessage);
            const deduped = applyDiversitySampling(confident, maxResults, cfg);
            const ensured = ensureMinResults(deduped, db, cfg.minResults);
            updateSessionContext(sessionKey, keywords, cfg);
            stats.recordQuery(makeSimpleTrace(ftsQuery, searchType, startMs, results.length, ensured.length));
            return buildHookResult(buildRecallContext(ensured, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
          }
        } catch (vecErr: unknown) {
          api.logger.debug?.(`[yaoyao-memory:recall] Vector search failed: ${(vecErr as Error).message}, falling back to FTS5`);
        }
      }

      // FTS5 search (with internal LIKE fallback for CJK)
      try {
        const rawResults = db.search(ftsQuery, maxResults);
        // Brain-style scope filtering: enforce multi-agent memory isolation
        const agentId = (api as Record<string, unknown>).agentId as string | undefined;
        const results = filterByScope(rawResults, scopeManager, agentId);
        if (results.length < rawResults.length) {
          api.logger.debug?.(`[yaoyao-memory:recall] Scope filter excluded ${rawResults.length - results.length} memories`);
        }
        // Apply score threshold filtering (Tencent-style)
      if (cfg.scoreThreshold > 0) {
        const before = results.length;
        results = results.filter(r => (r.score ?? 0) >= cfg.scoreThreshold);
        api.logger.debug?.(`[yaoyao-memory:recall] Score threshold ${cfg.scoreThreshold}: ${before} → ${results.length} results`);
        if (results.length === 0) {
          api.logger.debug?.("[yaoyao-memory:recall] All results below score threshold, skipping injection");
          return;
        }
      }

      if (results.length === 0) {
          api.logger.debug?.("[yaoyao-memory:recall] No relevant memories found");
          return;
        }

        setCachedResults(cacheKey, results, cfg);
        api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets in ${Date.now() - startMs}ms | decay=${decayed.length} | dedup=${deduped.length}`);

        // Apply enhancements
        const decayed = applyTimeDecay(results, cfg, cfg.decayMode);
        const scored = applyScoring(decayed, userMessage);
        const confident = applyConfidenceScoring(scored, userMessage);
        const deduped = applyDiversitySampling(confident, maxResults, cfg);
        const ensured = ensureMinResults(deduped, db, cfg.minResults);
        updateSessionContext(sessionKey, keywords, cfg);
        stats.recordQuery(makeSimpleTrace(ftsQuery, searchType, startMs, results.length, ensured.length));
        return buildHookResult(buildRecallContext(ensured, config.recall?.hintText as string, cfg.maxChars), config, cfg.position);
      } catch (searchErr: unknown) {
        api.logger.error(`[yaoyao-memory:recall] Search error: ${searchErr instanceof Error ? searchErr.message : String(searchErr)}`);
      }
    } catch (err) {
      api.logger.error(`[yaoyao-memory:recall] Error: ${err instanceof Error ? (err as Error).message : String(err)}`);
    }
    };

    // Tencent-style timeout: skip injection if recall exceeds threshold
    const result = await Promise.race([
      recallAsync(),
      new Promise((resolve) => setTimeout(() => resolve('__TIMEOUT__'), cfg.timeoutMs)),
    ]);
    if (result === '__TIMEOUT__') {
      api.logger.warn?.(`[yaoyao-memory:recall] Timeout after ${cfg.timeoutMs}ms, skipping injection`);
      return undefined;
    }
    return result;
  });
}

function extractKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1);

  const stopwords = new Set([
    "的",
    "了",
    "是",
    "在",
    "我",
    "有",
    "和",
    "就",
    "不",
    "人",
    "都",
    "一",
    "一个",
    "上",
    "也",
    "很",
    "到",
    "说",
    "要",
    "去",
    "你",
    "会",
    "着",
    "没有",
    "看",
    "好",
    "自己",
    "这",
    "那",
    "他",
    "她",
    "它",
    "们",
    "吗",
    "吧",
    "呢",
    "啊",
    "哦",
    "哈",
    "嗯",
    "嘛",
    "哟",
    "还是",
    "或者",
    "但是",
    "因为",
    "所以",
    "如果",
    "虽然",
    "而且",
    "然后",
    "可以",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
  ]);

  return words.filter((w) => !stopwords.has(w) && w.length <= 50);
}
