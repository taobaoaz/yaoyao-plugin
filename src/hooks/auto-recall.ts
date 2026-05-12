/**
 * auto-recall hook - injects relevant memories into the prompt context.
 *
 * Uses api.on("before_prompt_build", ...) to search memory via FTS5
 * and optionally sqlite-vec for semantic similarity search.
 *
 * Enhancements:
 * 1. Time decay scoring (30-day half-life)
 * 2. Diversity sampling (Jaccard dedup)
 * 3. Session context accumulation (cross-turn keyword carry-over)
 *
 * v1.5.0+: Removed L4 feedback tracking and persona state injection.
 *          Feedback learning moved to yaoyao-soul.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge, SearchResult } from "../utils/db-bridge.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { detectSentiment } from "../utils/sentiment.js";
import { createSessionFilter } from "../utils/session-filter.js";

// ── Search result cache (30s TTL, prevents duplicate DB hits on repeated queries) ──
const resultCache = new Map<string, { results: SearchResult[]; expires: number }>();
const CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_SIZE = 50;

function getCachedResults(key: string): SearchResult[] | null {
  const cached = resultCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.results;
  resultCache.delete(key);
  return null;
}

function setCachedResults(key: string, results: SearchResult[]): void {
  if (resultCache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [k, v] of resultCache) {
      if (v.expires < now || resultCache.size > MAX_CACHE_SIZE * 1.5) resultCache.delete(k);
    }
  }
  resultCache.set(key, { results, expires: Date.now() + CACHE_TTL_MS });
}

// ── Enhancement 3: Session context accumulation ──
// Maintains cross-turn keyword context per session to improve recall relevance.
const sessionContext = new Map<string, Set<string>>();
const MAX_SESSIONS = 1000;
const MAX_CONTEXT_KEYWORDS = 20;

function updateSessionContext(sessionKey: string, keywords: string[]): void {
  // Evict oldest session if over limit
  if (!sessionContext.has(sessionKey) && sessionContext.size >= MAX_SESSIONS) {
    const firstKey = sessionContext.keys().next().value;
    if (firstKey !== undefined) {
      sessionContext.delete(firstKey);
    }
  }
  if (!sessionContext.has(sessionKey)) {
    sessionContext.set(sessionKey, new Set<string>());
  }
  const ctx = sessionContext.get(sessionKey)!;
  for (const kw of keywords) {
    ctx.add(kw);
  }
  // Evict oldest when over limit
  if (ctx.size > MAX_CONTEXT_KEYWORDS) {
    const arr = Array.from(ctx);
    const toRemove = arr.slice(0, ctx.size - MAX_CONTEXT_KEYWORDS);
    for (const kw of toRemove) ctx.delete(kw);
  }
}

function getSessionContextKeywords(sessionKey: string): string[] {
  const ctx = sessionContext.get(sessionKey);
  return ctx ? Array.from(ctx) : [];
}

// ── Enhancement 1: Time decay scoring ──
// Applies exponential decay based on age: score *= exp(-daysAgo / halfLife)
// halfLife = 30 days (30-day-old memories have ~37% weight)
function applyTimeDecay(results: SearchResult[]): SearchResult[] {
  if (results.length <= 1) return results;
  const halfLife = 30;
  const now = Date.now();
  const dayMs = 86400000;

  return results
    .map((r, i) => {
      let daysAgo = 365;
      const dateMatch = r.filename.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const dateObj = new Date(dateMatch[1] + "T00:00:00");
        if (!isNaN(dateObj.getTime())) {
          daysAgo = Math.max(0, (now - dateObj.getTime()) / dayMs);
        }
      }
      // Default score when missing: positional (first=1.0, then -0.1)
      const originalScore = typeof r.score === "number" ? r.score : Math.max(0.1, 1.0 - i * 0.1);
      return { ...r, score: originalScore * Math.exp(-daysAgo / halfLife) };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ── Enhancement 2: Diversity sampling ──
// Removes near-duplicate entries (Jaccard similarity > 0.7 on first 50 chars)
function applyDiversitySampling(results: SearchResult[]): SearchResult[] {
  if (results.length <= 1) return results;

  function jaccardSimilarity(a: string, b: string): number {
    const snippetA = a.slice(0, 50);
    const snippetB = b.slice(0, 50);
    const setA = new Set<string>();
    const setB = new Set<string>();
    for (const ch of snippetA) setA.add(ch);
    for (const ch of snippetB) setB.add(ch);
    const intersect = new Set<string>([...setA].filter((x) => setB.has(x)));
    const union = new Set<string>([...setA, ...setB]);
    return union.size > 0 ? intersect.size / union.size : 0;
  }

  const kept: SearchResult[] = [];
  for (const r of results) {
    const isDuplicate = kept.some((k) => jaccardSimilarity(r.snippet, k.snippet) > 0.7);
    if (!isDuplicate) kept.push(r);
  }
  return kept;
}

/** Format search results into recall text snippet with sentiment emoji */
function formatRecallText(results: SearchResult[]): string {
  return results
    .map((r) => {
      const mood = detectSentiment(r.snippet);
      return `[${r.filename}] ${mood.emoji}\n${r.snippet}`;
    })
    .join("\n---\n");
}

/** Build the appendSystemContext object for return */
function buildRecallContext(results: SearchResult[]): { appendSystemContext: string } | undefined {
  if (results.length === 0) return undefined;
  const recallText = formatRecallText(results);
  return {
    appendSystemContext: `## 相关记忆\n\n以下内容来自你的对话历史记录，可能与当前对话相关：\n\n${recallText}\n`,
  };
}

/** Build prependSystemContext for static system prompt rules (cached by provider) */
function buildPrependRules(config: YaoyaoMemoryConfig): string | undefined {
  const rules: string[] = [];

  // 多模态记忆指令：开启 autoSaveImage 后，AI 自动将图片理解结果存入记忆
  const autoSaveImage = (config as Record<string, unknown>).autoSaveImage === true;
  if (autoSaveImage) {
    rules.push(
      "## 行为规则\n\n当用户发送图片或你通过任何方式获取到图片内容后，在回复用户之前，请调用 memory_save 工具，以 `[图片] 图片描述` 的格式将图片描述保存到记忆中。图片描述应为简洁的中文完整句子。",
    );
  }

  return rules.length > 0 ? rules.join("\n\n") : undefined;
}

/** Merge append + prepend context into a single return value */
function buildHookResult(
  appendCtx: { appendSystemContext: string } | undefined,
  config: YaoyaoMemoryConfig,
): { prependSystemContext: string; appendSystemContext: string } | { appendSystemContext: string } | undefined {
  if (!appendCtx && !config) return undefined;

  const prependSystemContext = buildPrependRules(config);

  if (!prependSystemContext) return appendCtx;

  return {
    prependSystemContext,
    appendSystemContext: appendCtx?.appendSystemContext || "",
  };
}

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: EmbeddingService | null,
) {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? " + vector" : ""})`);

  // Create session filter with configured blockLabels
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  api.on("before_prompt_build", async (event, ctx) => {
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

      // Extract keywords for FTS5 query
      const keywords = extractKeywords(userMessage);
      if (keywords.length === 0) {
        // Fallback: return most recent memory when all input is stopwords
        try {
          const fallback = db.getLatestMemory(1);
          if (fallback.length > 0) {
            api.logger.debug?.("[yaoyao-memory:recall] No keywords, using most recent memory as fallback");
            return buildHookResult(buildRecallContext(fallback), config);
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

      const ftsQuery = enrichedKeywords.join(" ");
      const maxResults = config.recall?.maxResults ?? 3;
      const hasVectorSearch = userMessage.toLowerCase().includes("tsne") || userMessage.toLowerCase().includes("向量") || userMessage.toLowerCase().includes("embedding") || userMessage.toLowerCase().includes("语义");
const searchType = hasVectorSearch ? "hybrid" : (embedding ? "fts" : "fts");
const cacheKey = `${searchType}:${ftsQuery}:${maxResults}`;

      // Check cache (30s TTL)
      const cached = getCachedResults(cacheKey);
      if (cached) {
        api.logger.debug?.("[yaoyao-memory:recall] Cache hit");
        // Apply enhancements to cached results
        const decayed = applyTimeDecay(cached);
        const deduped = applyDiversitySampling(decayed);
        updateSessionContext(sessionKey, keywords);
        return buildHookResult(buildRecallContext(deduped), config);
      }

      // Hybrid search: FTS5 + optional vector
      if (embedding) {
        try {
          const vec = await embedding.embed(userMessage);
          const results = db.hybridSearch(ftsQuery, vec, maxResults);
          if (results.length > 0) {
            setCachedResults(cacheKey, results);
            api.logger.info(
              `[yaoyao-memory:recall] Found ${results.length} snippets (hybrid) in ${Date.now() - startMs}ms`,
            );
            // Apply enhancements
            const decayed = applyTimeDecay(results);
            const deduped = applyDiversitySampling(decayed);
            updateSessionContext(sessionKey, keywords);
            return buildHookResult(buildRecallContext(deduped), config);
          }
        } catch (vecErr: any) {
          api.logger.debug?.(`[yaoyao-memory:recall] Vector search failed: ${vecErr.message}, falling back to FTS5`);
        }
      }

      // FTS5 search (with internal LIKE fallback for CJK)
      const results = db.search(ftsQuery, maxResults);
      if (results.length === 0) {
        api.logger.debug?.("[yaoyao-memory:recall] No relevant memories found");
        return;
      }

      setCachedResults(cacheKey, results);
      api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets in ${Date.now() - startMs}ms`);

      // Apply enhancements
      const decayed = applyTimeDecay(results);
      const deduped = applyDiversitySampling(decayed);
      updateSessionContext(sessionKey, keywords);
      return buildHookResult(buildRecallContext(deduped), config);
    } catch (err) {
      api.logger.error(`[yaoyao-memory:recall] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    "也",
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
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "can",
    "could",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
    "this",
    "that",
    "these",
    "those",
    "and",
    "or",
    "but",
    "if",
    "because",
    "when",
    "where",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "not",
    "no",
    "yes",
  ]);

  return words.filter((w) => !stopwords.has(w) && w.length < 30);
}
