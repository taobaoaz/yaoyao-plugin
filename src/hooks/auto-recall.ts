/**
 * auto-recall hook — injects relevant memories into the prompt context.
 *
 * Uses api.on("before_prompt_build", ...) to search memory via FTS5
 * and optionally sqlite-vec for semantic similarity search.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { detectSentiment } from "../utils/sentiment.js";

export function registerRecallHook(api: OpenClawPluginApi, db: DBBridge, config: YaoyaoMemoryConfig, embedding?: EmbeddingService | null) {
  api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? ' + vector' : ''})`);

  api.on("before_prompt_build", async (event, ctx) => {
    try {
      const startMs = Date.now();
      const e = event as Record<string, unknown>;
      const userMessage = e?.message || e?.prompt;
      if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length < 3) {
        return;
      }

      // Extract keywords for FTS5 query
      const keywords = extractKeywords(userMessage);
      if (keywords.length === 0) return;

      // Build FTS5 query — keywords already sanitized by db.search's sanitizeFTSQuery
      const ftsQuery = keywords.join(" ");
      const maxResults = config.recall?.maxResults ?? 3;
      const ftsResults = db.search(ftsQuery, maxResults);

      // If we have an embedding service, do vector search too
      if (embedding && ftsResults.length < maxResults) {
        try {
          const vec = await embedding.embed(userMessage);
          const vecResults = db.vectorSearch(vec, maxResults);
          if (vecResults.length > 0) {
            // Merge FTS5 + vector results (hybrid)
            const seen = new Set<string>();
            const combined: Array<{ filename: string; snippet: string; score: number }> = [];

            for (const r of ftsResults) {
              const key = `${r.date}|${r.snippet.slice(0, 50)}`;
              if (!seen.has(key)) {
                seen.add(key);
                combined.push(r);
              }
            }

            for (const r of vecResults) {
              const key = `${r.date}|${r.snippet.slice(0, 50)}`;
              if (!seen.has(key)) {
                seen.add(key);
                combined.push({ filename: r.filename, snippet: r.snippet, score: r.hybridScore, date: r.date });
              }
            }

            if (combined.length > 0) {
              const recallText = combined.sort((a, b) => b.score - a.score).slice(0, maxResults).map(r => {
                const mood = detectSentiment(r.snippet);
                return `[${r.filename}] ${mood.emoji}\n${r.snippet}`;
              }).join("\n---\n");

              api.logger.info(`[yaoyao-memory:recall] Found ${combined.length} snippets (hybrid) in ${Date.now() - startMs}ms`);
              return { appendSystemContext: `## 相关记忆\n\n以下内容来自你的对话历史记录，可能与当前对话相关：\n\n${recallText}\n` };
            }
          }
        } catch (vecErr: any) {
          api.logger.debug?.(`[yaoyao-memory:recall] Vector search failed: ${vecErr.message}, falling back to FTS5`);
        }
      }

      // FTS5-only results
      if (ftsResults.length === 0) {
        const topKeyword = keywords.slice(0, 3).join(" ");
        const fallback = db.search(topKeyword, maxResults);
        if (fallback.length === 0) {
          api.logger.debug?.("[yaoyao-memory:recall] No relevant memories found");
          return;
        }

        const recallText = fallback.map(r => {
          const mood = detectSentiment(r.snippet);
          return `[${r.filename}] ${mood.emoji}\n${r.snippet}`;
        }).join("\n---\n");

        api.logger.info(`[yaoyao-memory:recall] Found ${fallback.length} snippets in ${Date.now() - startMs}ms`);
        return { appendSystemContext: `## 相关记忆\n\n以下内容来自你的对话历史记录，可能与当前对话相关：\n\n${recallText}\n` };
      }

      const recallText = ftsResults.map(r => {
        const mood = detectSentiment(r.snippet);
        return `[${r.filename}] ${mood.emoji}\n${r.snippet}`;
      }).join("\n---\n");

      api.logger.info(`[yaoyao-memory:recall] Found ${ftsResults.length} snippets in ${Date.now() - startMs}ms`);
      return { appendSystemContext: `## 相关记忆\n\n以下内容来自你的对话历史记录，可能与当前对话相关：\n\n${recallText}\n` };
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
