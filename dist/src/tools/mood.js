import { detectSentiment, summarizeMood } from "../utils/sentiment.js";
import { withErrorHandling } from "./common.js";
export function createMoodTool(store) {
    return {
        name: "memory_mood",
        label: "Memory Mood",
        description: "Analyze the emotional tone of recent conversations — gives a 'mood ring' view of your memory history.",
        parameters: {
            type: "object",
            properties: {
                days: { type: "number", description: "How many days back to analyze (default: 7)", default: 7 },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const days = Math.min(Math.max(Number(params.days) || 7, 1), 90);
            const files = store.listFiles().filter(f => f.type === "daily").slice(0, days);
            if (files.length === 0) {
                return { content: [{ type: "text", text: "没有足够的数据来生成心情分析。" }] };
            }
            const allTexts = [];
            for (const f of files) {
                const content = store.readFile(f.path);
                if (content)
                    allTexts.push(content);
            }
            const sentimentResults = allTexts.map(t => detectSentiment(t));
            const posCount = sentimentResults.filter(r => r.label === 'positive').length;
            const negCount = sentimentResults.filter(r => r.label === 'negative').length;
            const neuCount = sentimentResults.filter(r => r.label === 'neutral').length;
            const total = sentimentResults.length;
            const summary = summarizeMood(allTexts);
            const moodEmoji = posCount > negCount ? '😊' : negCount > posCount ? '😟' : '😐';
            const lines = [
                `🎨 记忆心情环`,
                `───`,
                `📅 分析范围: 最近 ${days} 天 (${files.length} 条日志)`,
                `${moodEmoji} 总体: ${summary}`,
                ``,
                `📊 情绪分布:`,
                `   😊 积极: ${posCount} 条 (${(posCount / total * 100).toFixed(1)}%)`,
                `   😐 中性: ${neuCount} 条 (${(neuCount / total * 100).toFixed(1)}%)`,
                `   😢 消极: ${negCount} 条 (${(negCount / total * 100).toFixed(1)}%)`,
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }),
    };
}
