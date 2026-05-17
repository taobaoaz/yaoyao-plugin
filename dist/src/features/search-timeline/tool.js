/**
 * features/search-timeline/tool.ts — memory_search_timeline tool (modular).
 */
import { clampNum } from "../../utils/clamp.js";
import { detectSentiment } from "../../utils/sentiment.js";
import { withErrorHandling } from "../../tools/common.js";
export function createSearchTimelineTool(db) {
    return {
        id: "memory_search_timeline",
        name: "memory_search_timeline",
        label: "Memory Search with Timeline",
        description: "Search memories and show when they occurred on a timeline. Combines FTS5 search with temporal context for richer results.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" },
                maxResults: { type: "number", description: "Maximum results (default: 10)", default: 10 },
            },
            required: ["query"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const limit = clampNum(params.maxResults, 10, 1, 50);
            if (!query)
                return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
            const results = db.search(query, limit);
            if (results.length === 0) {
                return { content: [{ type: "text", text: `没有找到与 "${query}" 相关的记忆。` }] };
            }
            const byDate = new Map();
            for (const r of results) {
                const date = r.date || "unknown";
                if (!byDate.has(date))
                    byDate.set(date, []);
                byDate.get(date).push(r);
            }
            const sortedDates = [...byDate.keys()].sort().reverse();
            const parts = [`🔍 搜索: "${query}" (${results.length} 条结果)`, `───`];
            for (const date of sortedDates) {
                const items = byDate.get(date);
                parts.push(`📅 ${date} (${items.length} 条)`);
                for (const item of items) {
                    const sentiment = detectSentiment(item.snippet);
                    parts.push(`   ${sentiment.emoji} ${item.snippet.slice(0, 150)}`);
                    parts.push(`   (得分: ${item.score.toFixed(2)})`);
                }
                parts.push(``);
            }
            return { content: [{ type: "text", text: parts.join("\n") }] };
        }),
    };
}
