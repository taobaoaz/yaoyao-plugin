/**
 * memory_search_enhanced — 语义搜索增强版
 *
 * 在 FTS5 粗召回基础上，支持：
 * 1. 向量重排序（需配置 embedding API）
 * 2. 关键词高亮（匹配词加 ** 标记）
 * 3. 混合排序（FTS5 + Vec 加权组合）
 *
 * ⚠️ 此模块完全独立，所有 try-catch 兜底
 */

import type { DBBridge } from "../utils/db-bridge.js";
import { clampNum } from "../utils/clamp.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { detectSentiment } from "../utils/sentiment.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

/**
 * 在文本中高亮匹配的关键词（不区分大小写，支持 CJK）
 */
function highlightKeywords(text: string, keywords: string[]): string {
  let result = text;
  for (const kw of keywords) {
    if (!kw || kw.length < 2) continue;
    // Escape special regex chars
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // ReDoS protection: truncate overlong keywords
    const safeKw = escaped.slice(0, 100);
    try {
      const regex = new RegExp(`(${safeKw})`, "gi");
      result = result.replace(regex, " **$1** ");
    } catch { /* skip invalid regex */ }
  }
  // Clean up double spaces from wrapping
  return result.replace(/\s{2,}/g, " ");
}

/**
 * 提取关键词（用于高亮和搜索）
 */
function extractKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2);

  const stopwords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们",
    "吗", "吧", "呢", "啊", "哦", "哈", "嗯", "嘛", "哟",
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

/**
 * Cosine similarity (for reranking)
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Format a single result row
 */
function formatResult(snippet: string, filename: string, score: number): string {
  const mood = detectSentiment(snippet);
  return `${mood.emoji} 【${filename}】(得分: ${score.toFixed(3)})\n${snippet}`;
}

export function createEnhancedSearchTool(db: DBBridge, embedding?: EmbeddingService | null): ToolRegistration {
  return {
    name: "memory_search_enhanced",
    label: "Search (Rerank)",
    description: "语义搜索增强版。在全文搜索基础上支持向量重排序（需配置 embedding）和关键词高亮。支持 text / json 两种输出格式。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词（支持中英文、短语、自然语言）",
        },
        maxResults: {
          type: "number",
          description: "最大返回结果数（1-50，默认 10）",
          default: 10,
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "输出格式：text 返回可读的带高亮结果，json 返回结构化数据",
          default: "text",
        },
        highlight: {
          type: "boolean",
          description: "是否在结果中高亮关键词（默认 true）",
          default: true,
        },
      },
        snippetMaxLen: {
          type: "number",
          description: "搜索结果片段最大长度（字符数，默认 500）",
          default: 500,
        },
        ftsOverfetch: {
          type: "number",
          description: "FTS 粗召回超额倍数（默认 2，即取 limit*2）",
          default: 2,
        },
        ftsOverfetchMax: {
          type: "number",
          description: "FTS 粗召回绝对上限（默认 30）",
          default: 30,
        },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const query = String(params.query ?? "").trim();
      const limit = clampNum(params.maxResults, 10, 1, 50);
      const format = String(params.format || "text");
      const doHighlight = params.highlight !== false;
      const snippetMaxLen = clampNum(params.snippetMaxLen, 500, 50, 2000);
      const ftsOverfetch = clampNum(params.ftsOverfetch, 2, 1, 10);
      const ftsOverfetchMax = clampNum(params.ftsOverfetchMax, 30, 10, 200);

      if (!query) return { content: [{ type: "text", text: "请输入搜索关键词。" }] };

      const keywords = extractKeywords(query);

      // Step 1: FTS5 粗召回（取更多结果用于重排）
      const ftsLimit = embedding ? Math.min(limit * ftsOverfetch, ftsOverfetchMax) : limit;
      const ftsResults = db.search(query, ftsLimit);

      if (ftsResults.length === 0) {
        return { content: [{ type: "text", text: "没有找到相关记忆。" }] };
      }

      // Step 2: 如果有 embedding → 向量重排序（使用 embedBatch 避免 N+1 API 调用）
      if (embedding) {
        try {
          const queryVec = await embedding.embed(query);
          // Batch embed all snippets at once
          const snippets = ftsResults.map(r => r.snippet.slice(0, snippetMaxLen));
          const resultVecs = await embedding.embedBatch(snippets);

          const reranked = ftsResults.map((r, i) => {
            const vecScore = cosineSimilarity(queryVec, resultVecs[i]);
            // 混合评分：60% FTS5 + 40% 向量
            const hybridScore = (r.score * 0.6) + (vecScore * 0.4);
            return { ...r, vecScore, hybridScore };
          });

          reranked.sort((a, b) => b.hybridScore - a.hybridScore);
          const top = reranked.slice(0, limit);

          if (format === "json") {
            const results = doHighlight
              ? top.map(r => ({
                  filename: r.filename,
                  snippet: highlightKeywords(r.snippet, keywords),
                  score: r.hybridScore,
                  vecScore: r.vecScore,
                  date: r.date,
                }))
              : top.map(r => ({
                  filename: r.filename,
                  snippet: r.snippet,
                  score: r.hybridScore,
                  vecScore: r.vecScore,
                  date: r.date,
                }));
            return { content: [{ type: "text", text: JSON.stringify({ query, results, rerank: true, count: top.length }, null, 2) }] };
          }

          // Text format
          const lines = top.map(r => {
            const snippet = doHighlight ? highlightKeywords(r.snippet, keywords) : r.snippet;
            return formatResult(snippet, r.filename, r.hybridScore);
          });
          return { content: [{ type: "text", text: ["## 搜索结果（向量重排序）", `查询: ${query}`, "", ...lines].join("\n") }] };
        } catch { /* 向量重排序失败，降级到 FTS5 */ }
      }

      // Step 3: FTS5-only（无 embedding 或重排序失败）
      const results = ftsResults.slice(0, limit);

      if (format === "json") {
        const jsonResults = doHighlight
          ? results.map(r => ({ filename: r.filename, snippet: highlightKeywords(r.snippet, keywords), score: r.score, date: r.date }))
          : results.map(r => ({ filename: r.filename, snippet: r.snippet, score: r.score, date: r.date }));
        return { content: [{ type: "text", text: JSON.stringify({ query, results: jsonResults, rerank: false, count: results.length }, null, 2) }] };
      }

      const lines = results.map(r => {
        const snippet = doHighlight ? highlightKeywords(r.snippet, keywords) : r.snippet;
        return formatResult(snippet, r.filename, r.score);
      });
      return { content: [{ type: "text", text: ["## 搜索结果（FTS5）", `查询: ${query}`, "", ...lines].join("\n") }] };
    }),
  };
}
