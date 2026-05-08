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
import { detectSentiment } from "../utils/sentiment.js";
import { withErrorHandling } from "./common.js";
/**
 * 在文本中高亮匹配的关键词（不区分大小写，支持 CJK）
 */
function highlightKeywords(text, keywords) {
    let result = text;
    for (const kw of keywords) {
        if (!kw || kw.length < 2)
            continue;
        // Escape special regex chars
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
            const regex = new RegExp(`(${escaped})`, "gi");
            result = result.replace(regex, " **$1** ");
        }
        catch { /* skip invalid regex */ }
    }
    // Clean up double spaces from wrapping
    return result.replace(/\s{2,}/g, " ");
}
/**
 * 提取关键词（用于高亮和搜索）
 */
function extractKeywords(text) {
    const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
    const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
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
    const base = words.filter(w => !stopwords.has(w) && w.length < 30);
    // ── CJK bigram/trigram extraction ──
    const cjkSequences = cleaned.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const seq of cjkSequences) {
        if (seq.length >= 4) {
            for (let i = 0; i + 1 < seq.length; i++) {
                const bigram = seq.slice(i, i + 2);
                if (!stopwords.has(bigram)) base.push(bigram);
            }
            for (let i = 0; i + 2 < seq.length; i++) {
                const trigram = seq.slice(i, i + 3);
                if (!stopwords.has(trigram)) base.push(trigram);
            }
        }
        else if (seq.length >= 2) {
            if (!stopwords.has(seq)) base.push(seq);
        }
    }
    return [...new Set(base)];
}
// cosineSimilarity removed — vector reranking now uses db.vectorSearch()
/**
 * Format a single result row
 */
function formatResult(snippet, filename, score) {
    const mood = detectSentiment(snippet);
    return `${mood.emoji} 【${filename}】(得分: ${score.toFixed(3)})\n${snippet}`;
}
export function createEnhancedSearchTool(db, embedding) {
    const hasEmbedding = !!embedding;
    const dynamicDesc = hasEmbedding
        ? "🔍 语义搜索增强版。FTS5全文搜索 + 向量重排序，混合排序（FTS 0.6 + Vec 0.4）。支持中文、英文、混合查询。支持 text / json 输出格式。"
        : "🔍 增强搜索。支持关键词高亮和结果多样化，基于 FTS5 全文搜索。无需向量配置。支持 text / json 输出格式。";
    return {
        name: "memory_search_enhanced",
        label: "Search (Rerank)",
        description: dynamicDesc,
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
            required: ["query"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const limit = Math.min(Math.max(Number(params.maxResults) || 10, 1), 50);
            const format = String(params.format || "text");
            const doHighlight = params.highlight !== false;
            if (!query)
                return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
            const keywords = extractKeywords(query);
            // Step 1: FTS5 粗召回（取更多结果用于重排）
            const ftsLimit = embedding ? Math.min(limit * 2, 30) : limit;
            const ftsResults = db.search(query, ftsLimit);
            if (ftsResults.length === 0) {
                return { content: [{ type: "text", text: "没有找到相关记忆。" }] };
            }
            // Step 2: 如果有 embedding → 向量重排序（用 db.vectorSearch 替代逐条 embed）
            if (embedding) {
                try {
                    const queryVec = await embedding.embed(query);
                    // 1 次 vectorSearch，不再对每个 snippet 逐条 embed
                    const vecResults = (typeof db.vectorSearch === "function")
                        ? db.vectorSearch(queryVec, ftsLimit)
                        : [];
                    // 合并 FTS + Vec 结果（去重 + 加权）
                    const merged = new Map();
                    for (const r of ftsResults) {
                        const key = `${r.date}|${r.snippet.slice(0, 50)}`;
                        merged.set(key, { ...r, vecScore: 0, hybridScore: r.score * 0.6 });
                    }
                    for (const r of vecResults) {
                        const key = `${r.date}|${(r.snippet || "").slice(0, 50)}`;
                        const vecS = r.vectorScore || r.score || 0;
                        if (merged.has(key)) {
                            const existing = merged.get(key);
                            existing.vecScore = vecS;
                            existing.hybridScore = (existing.score * 0.6) + (vecS * 0.4);
                        }
                        else {
                            merged.set(key, { ...r, vecScore: vecS, hybridScore: vecS * 0.4 });
                        }
                    }
                    const top = [...merged.values()].sort((a, b) => b.hybridScore - a.hybridScore).slice(0, limit);
                    if (format === "json") {
                        const results = doHighlight
                            ? top.map(r => ({
                                filename: r.filename,
                                snippet: highlightKeywords(r.snippet || "", keywords),
                                score: r.hybridScore,
                                vecScore: r.vecScore,
                                date: r.date,
                            }))
                            : top.map(r => ({
                                filename: r.filename,
                                snippet: r.snippet || "",
                                score: r.hybridScore,
                                vecScore: r.vecScore,
                                date: r.date,
                            }));
                        return { content: [{ type: "text", text: JSON.stringify({ query, results, rerank: true, count: top.length }, null, 2) }] };
                    }
                    // Text format
                    const lines = top.map(r => {
                        const snippet = doHighlight ? highlightKeywords(r.snippet || "", keywords) : (r.snippet || "");
                        return formatResult(snippet, r.filename || "", r.hybridScore);
                    });
                    return { content: [{ type: "text", text: ["## 搜索结果（向量重排序）", `查询: ${query}`, "", ...lines].join("\n") }] };
                }
                catch { /* 向量重排序失败，降级到 FTS5 */ }
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
