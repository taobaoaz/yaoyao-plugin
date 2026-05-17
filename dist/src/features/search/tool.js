/**
 * features/search/tool.ts — memory_search tool (modular).
 *
 * Assembles core search logic + platform DB + sentiment formatting.
 */
import { clampNum } from "../../utils/clamp.js";
import { detectSentiment } from "../../utils/sentiment.js";
import { withErrorHandling } from "../../tools/common.js";
import { searchFTS } from "../../core/search/search.js";
export function createSearchTool(db) {
    return {
        id: "memory_search",
        name: "memory_search",
        label: "Yaoyao Memory Search",
        description: "Search through past memories using full-text search. Supports keywords, phrases, and natural language queries. Results are ranked by relevance.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query (keywords, phrases, natural language)" },
                maxResults: { type: "number", description: "Maximum results to return (default: 10)", default: 10 },
            },
            required: ["query"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const limit = clampNum(params.maxResults, 10, 1, 50);
            if (!query)
                return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
            // core layer: pure search logic
            const results = searchFTS(db.getRawDb(), query, limit);
            if (results.length === 0)
                return { content: [{ type: "text", text: "没有找到相关记忆。" }] };
            // presentation layer: formatting + sentiment
            const text = results.map(r => {
                const mood = detectSentiment(r.snippet);
                return `${mood.emoji} 【${r.filename}】(得分: ${r.score.toFixed(3)})\n${r.snippet}`;
            }).join("\n\n---\n\n");
            return { content: [{ type: "text", text }] };
        }),
    };
}
