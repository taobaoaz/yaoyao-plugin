import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";
export function createStatsTool(store, db) {
    return {
        name: "memory_stats",
        label: "Memory Stats",
        description: "📊 获取记忆统计信息：总数、日期分布、场景分组、标签、反馈学习、DB 健康状态。支持 text / json 格式和 basic / full 详细程度。format=json 返回结构化数据，detail=full 包含细分维度。",
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
            // Count tags
            let tagCount = 0;
            let uniqueTags = 0;
            try {
                const tagFilePath = path.join(store.baseDir, ".yaoyao.db");
                if (fs.existsSync(tagFilePath)) {
                    const { DatabaseSync } = _require("node:sqlite");
                    const tagDb = new DatabaseSync(tagFilePath, { allowExtension: true });
                    try {
                        const tagRow = tagDb.prepare("SELECT COUNT(*) as c FROM memory_tags").get();
                        tagCount = tagRow?.c || 0;
                        const uniqueRow = tagDb.prepare("SELECT COUNT(DISTINCT tag) as c FROM memory_tags").get();
                        uniqueTags = uniqueRow?.c || 0;
                    }
                    finally {
                        try {
                            tagDb.close();
                        }
                        catch { /* */ }
                    }
                }
            }
            catch { /* tags table may not exist */ }
            // Count scenes
            let sceneCount = 0;
            const sceneDir = path.join(store.baseDir, "scene_blocks");
            try {
                if (fs.existsSync(sceneDir)) {
                    sceneCount = fs.readdirSync(sceneDir).filter(f => f.endsWith(".md")).length;
                }
            }
            catch { /* */ }
            // Feedback size
            let feedbackSizeKB = 0;
            const feedbackPath = path.join(store.baseDir, ".feedback.jsonl");
            try {
                if (fs.existsSync(feedbackPath)) {
                    feedbackSizeKB = fs.statSync(feedbackPath).size / 1024;
                }
            }
            catch { /* */ }
            // Backup count
            let backupCount = 0;
            const backupDir = path.join(store.baseDir, ".backups");
            try {
                if (fs.existsSync(backupDir)) {
                    backupCount = fs.readdirSync(backupDir, { withFileTypes: true })
                        .filter(d => d.isDirectory() && d.name.startsWith("memory-backup-")).length;
                }
            }
            catch { /* */ }
            // Build JSON result
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
                // Date distribution
                if (dbStats.datesSummary && Array.isArray(dbStats.datesSummary)) {
                    jsonResult.dates = dbStats.datesSummary;
                }
            }
            if (format === "json") {
                // Add DB file size to JSON output
                try {
                    jsonResult.dbSizeKB = fs.existsSync(db.dbPath) ? (fs.statSync(db.dbPath).size / 1024).toFixed(1) : "0";
                } catch { jsonResult.dbSizeKB = "0"; }
                return { content: [{ type: "text", text: JSON.stringify(jsonResult, null, 2) }] };
            }
            // ── Text format ──
            const lines = [
                `📊 记忆统计`,
                `───`,
                `📁 总文件数: ${totalFiles} (每日日志: ${dailyFiles})`,
                `💾 总大小: ${(totalSizeBytes / 1024).toFixed(1)}KB`,
                `🔍 FTS5 索引条目: ${ftsMemories}`,
                // ── 优化7: 条件性向量统计输出 ──
            ];
            if (dbStats.vecEnabled) {
                lines.push(`📊 向量索引: ${dbStats.totalVectors || 0} 条 (${dbStats.dimensions || 0}维)`);
            } else {
                lines.push(`⚪ 向量搜索: 未启用（配置 embedding API 以启用）`);
            }
            if ((totalMemories || 0) < 10 && ftsMemories < 10) {
                lines.push(`💡 提示：当前记忆较少，系统会随使用逐渐积累`);
            }
            // ── DB file size ──
            try {
                const dbSize = fs.existsSync(db.dbPath) ? (fs.statSync(db.dbPath).size / 1024).toFixed(1) : "0";
                lines.push(`💿 DB 文件: ${dbSize} KB`);
            } catch {
                lines.push(`💿 DB 文件: N/A`);
            }
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
