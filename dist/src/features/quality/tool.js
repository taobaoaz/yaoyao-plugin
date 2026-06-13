/**
 * features/quality/tool.ts — memory_quality tool (modular).
 */
import { withErrorHandling } from "../../tools/common.js";
import fs from "node:fs";
import path from "node:path";
import { findDuplicates, jaccardSnippet, computeDateStats, generateRecommendations, formatQualityReport, formatDedupReport, } from "../../core/quality/quality.js";
export function createQualityTool(store, db) {
    return {
        id: "memory_quality",
        name: "memory_quality",
        label: "Memory Quality",
        description: "🩺 记忆质量评估 — 分析记忆数据库的健康度，包括覆盖率、重复度、新鲜度、索引完整性",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["report", "dedup"],
                    description: "report=生成质量报告, dedup=检测重复记忆",
                },
            },
            required: ["action"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action);
            if (action === "report") {
                return handleReport(store, db);
            }
            if (action === "dedup") {
                return handleDedup(db);
            }
            return { content: [{ type: "text", text: `❌ 未知操作: ${action}，支持: report, dedup` }] };
        }),
    };
}
async function handleReport(store, db) {
    let totalMemories = 0;
    try {
        const stats = db.getStats();
        totalMemories = stats.totalMemories || 0;
    }
    catch { /* best effort */ }
    let files = [];
    try {
        files = store.listFiles();
    }
    catch { /* best effort */ }
    const dailyFiles = files.filter((f) => f.type === "daily");
    const dateStats = computeDateStats(dailyFiles, totalMemories);
    let dbSizeKB = 0;
    let memoryDirSizeKB = 0;
    try {
        const dbPath = path.join(store.baseDir, ".yaoyao.db");
        if (fs.existsSync(dbPath)) {
            dbSizeKB = parseFloat((fs.statSync(dbPath).size / 1024).toFixed(1));
        }
    }
    catch { /* best effort */ }
    try {
        const allFiles = fs.readdirSync(store.baseDir, { withFileTypes: true });
        let totalBytes = 0;
        for (const f of allFiles) {
            if (f.isFile()) {
                try {
                    totalBytes += fs.statSync(path.join(store.baseDir, f.name)).size;
                }
                catch { /* */ }
            }
        }
        memoryDirSizeKB = parseFloat((totalBytes / 1024).toFixed(1));
    }
    catch { /* best effort */ }
    let duplicationRatio = 0;
    try {
        const sampleResults = db.search("*", 50);
        if (sampleResults.length > 1) {
            let similarPairs = 0;
            let totalPairs = 0;
            for (let i = 0; i < sampleResults.length && i < 30; i++) {
                for (let j = i + 1; j < sampleResults.length && j < 30; j++) {
                    totalPairs++;
                    const sim = jaccardSnippet(sampleResults[i].snippet, sampleResults[j].snippet);
                    if (sim > 0.7)
                        similarPairs++;
                }
            }
            duplicationRatio = totalPairs > 0 ? parseFloat(((similarPairs / totalPairs) * 100).toFixed(1)) : 0;
        }
    }
    catch { /* best effort */ }
    const recs = generateRecommendations(dateStats.dateCoverage, dateStats.totalDays, duplicationRatio, dbSizeKB, memoryDirSizeKB, dateStats.recent7Count, dailyFiles.length);
    const report = formatQualityReport(files.length, dailyFiles.length, totalMemories, memoryDirSizeKB, dbSizeKB, dateStats, duplicationRatio, recs);
    return { content: [{ type: "text", text: report }] };
}
async function handleDedup(db) {
    let results = [];
    try {
        // Use a wildcard search instead of empty string for consistent FTS5 behavior
        results = db.search("*", 100);
    }
    catch { /* best effort */ }
    if (results.length < 2) {
        return {
            content: [{
                    type: "text",
                    text: results.length === 0 ? "✅ 数据库中无记忆条目" : "✅ 仅有一条记忆，无需去重检测",
                }],
        };
    }
    const duplicates = findDuplicates(results, 0.8);
    return { content: [{ type: "text", text: formatDedupReport(duplicates) }] };
}
