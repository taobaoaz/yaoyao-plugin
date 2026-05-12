import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";
export function createQualityTool(store, db) {
    return {
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
                return handleDedup(store, db);
            }
            return { content: [{ type: "text", text: `❌ 未知操作: ${action}，支持: report, dedup` }] };
        }),
    };
}
async function handleReport(store, db) {
    // 1. Total memories from FTS5
    let totalMemories = 0;
    try {
        const stats = db.getStats();
        totalMemories = stats.totalMemories || 0;
    }
    catch {
        /* best effort */
    }
    // 2. File listing & date coverage
    let files = [];
    try {
        files = store.listFiles();
    }
    catch {
        /* best effort */
    }
    const dailyFiles = files.filter((f) => f.type === "daily");
    const totalFiles = files.length;
    // Date coverage: compute date range from filenames
    let dateCoverage = 0;
    let avgPerDay = 0;
    let recent7Count = 0;
    let recent30Count = 0;
    let totalDays = 0;
    if (dailyFiles.length > 0) {
        const dates = dailyFiles
            .map((f) => f.filename.replace(/\.md$/i, ""))
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort();
        if (dates.length > 0) {
            const first = new Date(dates[0] + "T00:00:00");
            const last = new Date(dates[dates.length - 1] + "T00:00:00");
            totalDays = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 86400000) + 1);
            dateCoverage = parseFloat(((dates.length / totalDays) * 100).toFixed(1));
        }
        avgPerDay = dates.length > 0 ? parseFloat((totalMemories / dates.length).toFixed(1)) : 0;
        // Freshness: recent 7 / 30 days
        const now = new Date();
        const msDay = 86400000;
        for (const d of dates) {
            const diffDays = (now.getTime() - new Date(d + "T00:00:00").getTime()) / msDay;
            if (diffDays >= 0) {
                if (diffDays <= 7)
                    recent7Count++;
                if (diffDays <= 30)
                    recent30Count++;
            }
        }
    }
    // 3. DB file size
    let dbSizeKB = 0;
    let memoryDirSizeKB = 0;
    try {
        const dbPath = path.join(store.baseDir, ".yaoyao.db");
        if (fs.existsSync(dbPath)) {
            dbSizeKB = parseFloat((fs.statSync(dbPath).size / 1024).toFixed(1));
        }
    }
    catch {
        /* best effort */
    }
    try {
        const allFiles = fs.readdirSync(store.baseDir, { withFileTypes: true });
        let totalBytes = 0;
        for (const f of allFiles) {
            if (f.isFile()) {
                try {
                    totalBytes += fs.statSync(path.join(store.baseDir, f.name)).size;
                }
                catch {
                    /* */
                }
            }
        }
        memoryDirSizeKB = parseFloat((totalBytes / 1024).toFixed(1));
    }
    catch {
        /* best effort */
    }
    // 4. Basic dedup check (sample-based)
    let duplicationRatio = 0;
    try {
        // Sample up to 50 entries from FTS5 via generic search
        const sampleResults = db.search("", 50);
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
    catch {
        /* best effort */
    }
    // ── Build report ──
    const lines = [
        "🩺 **记忆质量评估报告**",
        "",
        `📁 **存储概览**`,
        `- 记忆文件总数: ${totalFiles}`,
        `- 每日日志文件: ${dailyFiles.length}`,
        `- FTS5 索引条目: ${totalMemories}`,
        `- 记忆目录大小: ${memoryDirSizeKB} KB`,
        `- 数据库文件大小: ${dbSizeKB} KB`,
        "",
        `📅 **日期覆盖**`,
        `- 有记忆的天数: ${dailyFiles.length}`,
        `- 覆盖天数范围: ${totalDays} 天`,
        `- 日期覆盖率: ${dateCoverage}%`,
        `- 平均每天条目: ${avgPerDay}`,
        "",
        `🆕 **新鲜度**`,
        `- 最近 7 天有记忆: ${recent7Count} 天`,
        `- 最近 30 天有记忆: ${recent30Count} 天`,
        "",
        `🔁 **重复度 (抽样)**`,
        `- 疑似重复比例: ${duplicationRatio}%`,
    ];
    // Index integrity
    const integrityOK = totalMemories > 0 || dailyFiles.length === 0;
    lines.push(``, `🔧 **索引完整性**`, `- 状态: ${integrityOK ? "✅ 正常" : "⚠️ 可能有问题"}`);
    if (!integrityOK) {
        lines.push(`- 提示: 存在每日日志文件但 FTS5 索引为空，建议运行 memory_optimize`);
    }
    // Recommendations
    const recs = [];
    if (dateCoverage < 50 && totalDays > 7) {
        recs.push("• 日期覆盖率偏低，建议增加记忆保存频率");
    }
    if (duplicationRatio > 20) {
        recs.push("• 重复度较高，建议运行 memory_quality(action:dedup) 检测具体重复项");
    }
    if (dbSizeKB > 0 && memoryDirSizeKB > 0 && dbSizeKB > memoryDirSizeKB * 0.5) {
        recs.push("• 数据库文件相对较大，建议运行 memory_optimize 清理无用索引");
    }
    if (recent7Count === 0 && dailyFiles.length > 0) {
        recs.push("• 最近 7 天无新记忆，建议检查 auto-capture 是否正常运行");
    }
    if (recs.length > 0) {
        lines.push(``, `💡 **建议**`);
        for (const r of recs) {
            lines.push(r);
        }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
async function handleDedup(store, db) {
    // Sample up to 100 entries from FTS5
    let results = [];
    try {
        results = db.search("", 100);
    }
    catch {
        /* best effort */
    }
    if (results.length < 2) {
        return {
            content: [
                {
                    type: "text",
                    text: results.length === 0 ? "✅ 数据库中无记忆条目" : "✅ 仅有一条记忆，无需去重检测",
                },
            ],
        };
    }
    // Pairwise similarity check
    const duplicates = [];
    for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
            const sim = jaccardSnippet(results[i].snippet, results[j].snippet);
            if (sim > 0.8) {
                duplicates.push({ a: results[i], b: results[j], similarity: parseFloat(sim.toFixed(3)) });
            }
        }
    }
    if (duplicates.length === 0) {
        return { content: [{ type: "text", text: "✅ 抽样检测未发现重复条目（相似度阈值 0.8）" }] };
    }
    // Group by similarity for cleaner output
    const lines = [
        `🔍 检测到 ${duplicates.length} 组疑似重复`,
        `（基于 snippet 前100字符的 Jaccard 相似度 > 0.8）`,
        "",
    ];
    for (let k = 0; k < Math.min(duplicates.length, 20); k++) {
        const d = duplicates[k];
        lines.push(`**${k + 1}. 相似度: ${d.similarity}**`, `  A: [${d.a.filename}] ${d.a.snippet.slice(0, 80)}...`, `  B: [${d.b.filename}] ${d.b.snippet.slice(0, 80)}...`, "");
    }
    if (duplicates.length > 20) {
        lines.push(`...以及 ${duplicates.length - 20} 组更多重复`);
    }
    lines.push("💡 如需删除重复项，请使用 memory_forget 手动处理");
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
/** Compute Jaccard similarity on first N chars of two snippets */
function jaccardSnippet(a, b, chars = 100) {
    const snippetA = a.slice(0, chars);
    const snippetB = b.slice(0, chars);
    const setA = new Set();
    const setB = new Set();
    for (const ch of snippetA)
        setA.add(ch);
    for (const ch of snippetB)
        setB.add(ch);
    const intersect = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size > 0 ? intersect.size / union.size : 0;
}
