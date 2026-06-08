/**
 * features/enhanced-search/tool.ts — memory_search_enhanced tool.
 *
 * FTS5 + RRF + 向量重排序 + 关键词高亮 + 双格式输出。
 * 数据查询通过 SearchPipeline，增强功能（高亮、关键词）保持本地。
 */
import { clampNum } from "../../utils/clamp.js";
import { detectSentiment } from "../../core/sentiment/index.js";
import { withErrorHandling } from "../../tools/common.js";
import { highlightKeywords, extractKeywords } from "../../core/search/enhanced.js";
function formatResult(snippet, filename, score) {
    const mood = detectSentiment(snippet);
    return `${mood.emoji} 【${filename}】(得分: ${score.toFixed(3)})\n${snippet}`;
}
export function createEnhancedSearchTool(pipeline) {
    return {
        id: 'memory_search_enhanced',
        name: 'memory_search_enhanced',
        label: 'Search (Rerank)',
        description: '语义搜索增强版。在全文搜索基础上支持向量重排序（需配置 embedding）和关键词高亮。支持 text / json 两种输出格式。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词（支持中英文、短语、自然语言）',
                },
                maxResults: {
                    type: 'number',
                    description: '最大返回结果数（1-50，默认 10）',
                    default: 10,
                },
                format: {
                    type: 'string',
                    enum: ['text', 'json'],
                    description: '输出格式：text 返回可读的带高亮结果，json 返回结构化数据',
                    default: 'text',
                },
                highlight: {
                    type: 'boolean',
                    description: '是否在结果中高亮关键词（默认 true）',
                    default: true,
                },
                snippetMaxLen: {
                    type: 'number',
                    description: '搜索结果片段最大长度（字符数，默认 500）',
                    default: 500,
                },
                strategy: {
                    type: 'string',
                    enum: ['fts', 'hybrid', 'rrf', 'multi-signal', 'additive'],
                    description: '搜索策略（默认 rrf，有 embedding 时自动启用）',
                    default: 'rrf',
                },
                ftsOverfetch: {
                    type: 'number',
                    description: 'FTS 粗召回超额倍数（默认 2）',
                    default: 2,
                },
                ftsOverfetchMax: {
                    type: 'number',
                    description: 'FTS 粗召回绝对上限（默认 30）',
                    default: 30,
                },
            },
            required: ['query'],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? '').trim();
            const limit = clampNum(params.maxResults, 10, 1, 50);
            const format = String(params.format || 'text');
            const doHighlight = params.highlight !== false;
            const strategy = String(params.strategy || 'rrf');
            const ftsOverfetch = clampNum(params.ftsOverfetch, 2, 1, 10);
            const ftsOverfetchMax = clampNum(params.ftsOverfetchMax, 30, 10, 200);
            if (!query)
                return { content: [{ type: 'text', text: '请输入搜索关键词。' }] };
            const keywords = extractKeywords(query);
            const overfetchLimit = Math.min(limit * ftsOverfetch, ftsOverfetchMax);
            // 通过 SearchPipeline 查询（FTS / RRF / hybrid 由 pipeline 决定）
            const results = await pipeline.search(query, {
                strategy,
                limit: overfetchLimit,
            });
            if (results.length === 0) {
                return { content: [{ type: 'text', text: '没有找到相关记忆。' }] };
            }
            // 取 top N
            const top = results.slice(0, limit);
            if (format === 'json') {
                const jsonResults = doHighlight
                    ? top.map((r) => ({
                        filename: r.filename,
                        snippet: highlightKeywords(r.snippet, keywords),
                        score: r.hybridScore ?? r.score,
                        vecScore: r.vectorScore,
                        date: r.date,
                    }))
                    : top.map((r) => ({
                        filename: r.filename,
                        snippet: r.snippet,
                        score: r.hybridScore ?? r.score,
                        vecScore: r.vectorScore,
                        date: r.date,
                    }));
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ query, results: jsonResults, strategy, count: top.length }, null, 2),
                        },
                    ],
                };
            }
            const lines = top.map((r) => {
                const snippet = doHighlight ? highlightKeywords(r.snippet, keywords) : r.snippet;
                const score = r.hybridScore ?? r.score;
                return formatResult(snippet, r.filename, score);
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: ['## 搜索结果', `策略: ${strategy}`, `查询: ${query}`, '', ...lines].join('\n'),
                    },
                ],
            };
        }),
    };
}
