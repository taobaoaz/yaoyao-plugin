/**
 * features/stats/tool.ts — memory_stats tool (modular).
 */
import { withErrorHandling } from "../../tools/common.js";
import { globalRetrievalStats } from "../../utils/retrieval-stats.js";
import fs from "node:fs";
import path from "node:path";
export function createStatsTool(store, db) {
    return {
        name: "memory_stats",
        label: "Memory Stats",
        description: "获取记忆统计信息：总数、日期分布、场景分组、标签、反馈学习、DB 健康状态。支持 text / json 两种格式。",
        parameters: {
            type: "object",
            properties: {
                format: {
                    type: "string",
                    enum: ["text", "json"],
                    description: "输出格式：text 返回可读统计（默认），json 返回结构化数据",
                    default: "text",
                },
                detail: {
                    type: "string",
                    enum: ["basic", "full"],
                    description: "详细程度：basic 基础统计，full 包含细分维度",
                    default: "basic",
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const format = String(params.format || "text");
            const detail = String(params.detail || "basic");
            const dbStats = db.getStats();
            const files = store.listFiles();
            const totalFiles = files.length;
            const dailyFiles = files.filter(f => f.type === "daily").length;
            const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
            const ftsMemories = dbStats.totalMemories || 0;
            let tagCount = 0;
            let uniqueTags = 0;
            try {
                const rawDb = db.getRawDb();
                const tagRow = rawDb.prepare("SELECT COUNT(*) as c FROM memory_tags").get();
                tagCount = tagRow?.c || 0;
                const uniqueRow = rawDb.prepare("SELECT COUNT(DISTINCT tag) as c FROM memory_tags").get();
                uniqueTags = uniqueRow?.c || 0;
            }
            catch { /* tags table may not exist */ }
            // Retrieval stats from Brain-style collector
            const retrievalStats = globalRetrievalStats.getStats();
            let sceneCount = 0;
            const sceneDir = path.join(store.baseDir, "scene_blocks");
            try {
                if (fs.existsSync(sceneDir)) {
                    sceneCount = fs.readdirSync(sceneDir).filter(f => f.endsWith(".md")).length;
                }
            }
            catch { /* */ }
            let feedbackSizeKB = 0;
            const feedbackPath = path.join(store.baseDir, ".feedback.jsonl");
            try {
                if (fs.existsSync(feedbackPath)) {
                    feedbackSizeKB = fs.statSync(feedbackPath).size / 1024;
                }
            }
            catch { /* */ }
            let backupCount = 0;
            const backupDir = path.join(store.baseDir, ".backups");
            try {
                if (fs.existsSync(backupDir)) {
                    backupCount = fs.readdirSync(backupDir, { withFileTypes: true })
                        .filter(d => d.isDirectory() && d.name.startsWith("memory-backup-")).length;
                }
            }
            catch { /* */ }
            const jsonResult = {
                totalFiles,
                dailyFiles,
                totalSizeKB: (totalSizeBytes / 1024).toFixed(1),
                ftsMemories,
            };
            if (detail === "full") {
                jsonResult.tags = { totalEntries: tagCount, uniqueTags };
                jsonResult.scenes = { count: sceneCount };
                jsonResult.feedback = { sizeKB: feedbackSizeKB.toFixed(1) };
                jsonResult.backups = { count: backupCount };
                if (dbStats.datesSummary && Array.isArray(dbStats.datesSummary)) {
                    jsonResult.dates = dbStats.datesSummary;
                }
                jsonResult.retrieval = retrievalStats;
            }
            if (format === "json") {
                return { content: [{ type: "text", text: JSON.stringify(jsonResult, null, 2) }] };
            }
            const lines = [
                `📊 记忆统计`,
                `───`,
                `📁 总文件数: ${totalFiles} (每日日志: ${dailyFiles})`,
                `💾 总大小: ${(totalSizeBytes / 1024).toFixed(1)}KB`,
                `🔍 FTS5 索引条目: ${ftsMemories}`,
                `⚡ 检索统计: ${retrievalStats.totalQueries} 次查询 | 平均 ${retrievalStats.avgLatencyMs}ms | P95 ${retrievalStats.p95LatencyMs}ms | 零结果 ${retrievalStats.zeroResultQueries} 次`,
            ];
            if (detail === "full") {
                if (sceneCount > 0)
                    lines.push(`📂 场景分组: ${sceneCount} 个`);
                if (uniqueTags > 0)
                    lines.push(`🏷️ 标签: ${tagCount} 条 (${uniqueTags} 个不同标签)`);
                if (backupCount > 0)
                    lines.push(`💿 备份: ${backupCount} 个快照`);
                if (feedbackSizeKB > 0)
                    lines.push(`🧠 反馈记录: ${feedbackSizeKB.toFixed(1)}KB`);
                if (dbStats.datesSummary && Array.isArray(dbStats.datesSummary)) {
                    const dates = dbStats.datesSummary;
                    if (dates.length > 0) {
                        lines.push(``, `📅 按日期分布:`);
                        for (const d of dates) {
                            lines.push(`   ${d.date}: ${d.count} 条`);
                        }
                    }
                }
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }),
    };
}
