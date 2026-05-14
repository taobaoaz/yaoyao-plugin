/**
 * features/enhanced-search/tool.ts — memory_search_enhanced tool (modular).
 */
import { clampNum } from "../../utils/clamp.js";
import { detectSentiment } from "../../utils/sentiment.js";
import { withErrorHandling } from "../../tools/common.js";
import { highlightKeywords, extractKeywords, cosineSimilarity } from "../../core/search/enhanced.js";
function formatResult(snippet, filename, score) {
    const mood = detectSentiment(snippet);
    return `${mood.emoji} 【${filename}】(得分: ${score.toFixed(3)})\n${snippet}`;
}
export function createEnhancedSearchTool(db, embedding) {
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
            required: ["query"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const limit = clampNum(params.maxResults, 10, 1, 50);
            const format = String(params.format || "text");
            const doHighlight = params.highlight !== false;
            const snippetMaxLen = clampNum(params.snippetMaxLen, 500, 50, 2000);
            const ftsOverfetch = clampNum(params.ftsOverfetch, 2, 1, 10);
            const ftsOverfetchMax = clampNum(params.ftsOverfetchMax, 30, 10, 200);
            if (!query)
                return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
            const keywords = extractKeywords(query);
            // Step 1: FTS5 粗召回
            const ftsLimit = embedding ? Math.min(limit * ftsOverfetch, ftsOverfetchMax) : limit;
            const ftsResults = db.search(query, ftsLimit);
            if (ftsResults.length === 0) {
                return { content: [{ type: "text", text: "没有找到相关记忆。" }] };
            }
            // Step 2: 向量重排序
            if (embedding) {
                try {
                    const queryVec = await embedding.embed(query);
                    const snippets = ftsResults.map(r => r.snippet.slice(0, snippetMaxLen));
                    const resultVecs = await embedding.embedBatch(snippets);
                    const reranked = ftsResults.map((r, i) => {
                        const vecScore = cosineSimilarity(queryVec, resultVecs[i]);
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
                    const lines = top.map(r => {
                        const snippet = doHighlight ? highlightKeywords(r.snippet, keywords) : r.snippet;
                        return formatResult(snippet, r.filename, r.hybridScore);
                    });
                    return { content: [{ type: "text", text: ["## 搜索结果（向量重排序）", `查询: ${query}`, "", ...lines].join("\n") }] };
                }
                catch { /* 向量重排序失败，降级到 FTS5 */ }
            }
            // Step 3: FTS5-only
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
