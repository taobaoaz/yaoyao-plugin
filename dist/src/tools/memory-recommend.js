/**
 * memory_recommend tool — 记忆推荐引擎
 *
 * 基于当前上下文推荐相关记忆。与搜索不同：
 * - 日期多样性：不同日期的记忆不会被全部聚在一起
 * - 有时间衰减：近期的记忆权重更高（30天半衰期）
 * - 冷启动保护：数据少时也会尽量提供多样化
 *
 * 工具名: memory_recommend
 * 使用: memory_recommend({ context: "最近在做什么项目", limit: 5 })
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */
import { withErrorHandling } from "./common.js";
export function createRecommendTool(db, memoryDir) {
    return {
        name: "memory_recommend",
        label: "Recommend Memories",
        description: "💡 记忆推荐引擎。与搜索不同，推荐侧重多样性和时间衰减——混合不同日期的记忆，近期权重更高（30天半衰期）。适合浏览回顾。",
        parameters: {
            type: "object",
            properties: {
                context: {
                    type: "string",
                    description: "当前上下文（如用户刚说的内容），用于匹配相关记忆",
                },
                limit: {
                    type: "number",
                    description: "推荐数量（1-20，默认 5）",
                    default: 5,
                },
                diversity: {
                    type: "number",
                    description: "多样化程度（0-1，0=纯相关度，1=最大多样化），默认 0.3",
                    default: 0.3,
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const context = String(params.context || "").trim();
            const limit = Math.min(20, Math.max(1, Number(params.limit) || 5));
            if (!context) {
                // 无上下文时：推荐近期记忆（按日期降序）
                const stmt = db.prepare("SELECT date, user_text, asst_text FROM memory_meta ORDER BY date DESC LIMIT ?");
                const recent = stmt.all(limit);
                if (recent.length === 0) {
                    return { content: [{ type: "text", text: "暂无记忆可推荐。" }] };
                }
                const lines = recent.map((r, i) => `${i + 1}. [${r.date}] ${(r.user_text || "").slice(0, 100)}`);
                return { content: [{ type: "text", text: "## 近期记忆\n\n" + lines.join("\n") }] };
            }
            // 有上下文时：搜索 + 日期多样性 + 时间衰减
            const rawResults = db.search(context, Math.min(limit * 3, 30));
            if (rawResults.length === 0) {
                return { content: [{ type: "text", text: "没有找到相关的记忆。" }] };
            }
            // 按 date 分组，每组只保留 1 条（日期多样性）
            const dateGroups = new Map();
            for (const r of rawResults) {
                const date = r.filename?.replace(".md", "") || "unknown";
                if (!dateGroups.has(date)) {
                    dateGroups.set(date, r);
                }
            }
            const candidates = [...dateGroups.values()];
            // 时间衰减：30天半衰期
            const now = Date.now();
            const halfLife = 30 * 86400000; // 30 days in ms
            const scored = candidates.map(r => {
                const date = r.filename?.replace(".md", "") || "";
                const ts = date ? new Date(date + "T00:00:00").getTime() : 0;
                const ageMs = Math.max(0, now - ts);
                const timeDecay = Math.pow(0.5, ageMs / halfLife);
                return { ...r, date, finalScore: r.score * 0.7 + timeDecay * 0.3 };
            });
            scored.sort((a, b) => b.finalScore - a.finalScore);
            const selected = scored.slice(0, limit);
            // 格式输出
            const lines = selected.map((r, i) => {
                const scoreBar = "█".repeat(Math.round(r.finalScore * 10));
                return `${i + 1}. [${r.date}] ${(r.snippet || "").slice(0, 120)}  ${scoreBar}`;
            });
            return {
                content: [{
                    type: "text",
                    text: [
                        `## 记忆推荐`,
                        `基于: "${context}"`,
                        ``,
                        ...lines,
                    ].join("\n"),
                }],
            };
        }),
    };
}
