/**
 * auto-recall hook — injects relevant memories into the prompt context.
 *
 * Uses api.on("before_prompt_build", ...) to search memory via FTS5
 * and optionally sqlite-vec for semantic similarity search.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge, SearchResult } from "../utils/db-bridge.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { detectSentiment } from "../utils/sentiment.js";
import { createSessionFilter } from "../utils/session-filter.js";
import { PersonaStateMachine } from "../utils/persona-state.js";
import type { FeedbackTracker } from "../learning/feedback-tracker.js";

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

/** Format search results into recall text snippet with sentiment emoji */
function formatRecallText(results: SearchResult[]): string {
  return results.map(r => {
    const mood = detectSentiment(r.snippet);
    return `[${r.filename}] ${mood.emoji}\n${r.snippet}`;
  }).join("\n---\n");
}

/** Build the appendSystemContext object for return */
function buildRecallContext(results: SearchResult[], guidance?: string): { appendSystemContext: string } | undefined {
  if (results.length === 0 && !guidance) return undefined;
  const parts: string[] = [];
  
  if (results.length > 0) {
    const recallText = formatRecallText(results);
    parts.push(`## 相关记忆\n\n以下内容来自你的对话历史记录，可能与当前对话相关：\n\n${recallText}\n`);
  }
  
  if (guidance) {
    parts.push(`## 交互引导\n\n${guidance}\n`);
  }
  
  if (parts.length === 0) return undefined;
  return { appendSystemContext: parts.join("\n") };
}

export function registerRecallHook(
  api: OpenClawPluginApi,
  db: DBBridge,
  config: YaoyaoMemoryConfig,
  embedding?: EmbeddingService | null,
  personaState?: PersonaStateMachine | null,
  feedbackTracker?: FeedbackTracker | null
) {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? ' + vector' : ''})`);

  // Create session filter with configured blockLabels
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });

  // ── Correction detection patterns (simple keyword/pattern matching) ──
  function detectCorrection(userMessage: string): { isCorrection: boolean; tag: string } | null {
    const lower = userMessage.toLowerCase();
    // Check for common correction patterns
    const correctionPatterns: Array<{ patterns: string[]; tag: string }> = [
      { patterns: ["不对", "不是", "错了", "不应该", "不是这样的"], tag: "memory" },
      { patterns: ["不要说", "别这么说", "语气不对", "别用"], tag: "tone" },
      { patterns: ["不相关", "没关系", "不是问这个"], tag: "relevance" },
      { patterns: ["太啰嗦", "太简洁", "说详细点", "简短点"], tag: "timing" },
    ];
    for (const { patterns, tag } of correctionPatterns) {
      if (patterns.some(p => lower.includes(p))) {
        return { isCorrection: true, tag };
      }
    }
    return null;
  }

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

      // ── L4 Feedback: detect user corrections and record them ──
      if (feedbackTracker && typeof userMessage === "string") {
        try {
          const correction = detectCorrection(userMessage);
          if (correction) {
            feedbackTracker.record({
              type: "correction",
              original: userMessage.slice(0, 200),
              tag: correction.tag as any,
              context: `session: ${sessionKey}`,
            });
            api.logger.info(`[yaoyao-memory:feedback] Recorded correction (tag: ${correction.tag})`);
          }
        } catch { /* best effort */ }
      }

      // Extract keywords for FTS5 query
      const keywords = extractKeywords(userMessage);
      if (keywords.length === 0) return;

      const ftsQuery = keywords.join(" ");
      const maxResults = config.recall?.maxResults ?? 3;
      const cacheKey = `${ftsQuery}:${maxResults}`;

      // Check cache (30s TTL)
      const cached = getCachedResults(cacheKey);
      if (cached) {
        api.logger.debug?.("[yaoyao-memory:recall] Cache hit");
        // Compute guidance from persona state (always fresh)
        let guidance = "";
        if (personaState && personaState.getState().confidence > 0.3) {
          try { guidance = personaState.getGuidanceText(); } catch { /* best effort */ }
        }
        return buildRecallContext(cached, guidance);
      }

      // Build guidance text from persona state (best-effort, never blocks)
      let guidance = "";
      if (personaState && personaState.getState().confidence > 0.3) {
        try { guidance = personaState.getGuidanceText(); } catch { /* best effort */ }
      }

      // Hybrid search: FTS5 + optional vector
      if (embedding) {
        try {
          const vec = await embedding.embed(userMessage);
          const results = db.hybridSearch(ftsQuery, vec, maxResults);
          if (results.length > 0) {
            setCachedResults(cacheKey, results);
            api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets (hybrid) in ${Date.now() - startMs}ms`);
            return buildRecallContext(results, guidance);
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
      return buildRecallContext(results, guidance);
    } catch (err) {
      api.logger.error(`[yaoyao-memory:recall] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function extractKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);

  const stopwords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们",
    "也", "吗", "吧", "呢", "啊", "哦", "哈", "嗯", "嘛", "哟",
    "还是", "或者", "但是", "因为", "所以", "如果", "虽然", "而且", "然后", "可以",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
  ]);

  return words.filter(w => !stopwords.has(w) && w.length < 30);
}
