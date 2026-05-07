/**
 * feedback-tracker.ts — L4 反馈学习层核心模块
 *
 * 持久化用户反馈（纠错、点赞等），为后续偏好学习提供数据基础。
 *
 * 数据存储：<memoryDir>/.feedback.jsonl
 * 每行一个 JSON 对象，格式：
 *   {"type":"correction|praise","original":"...","corrected":"...","tag":"memory|tone|relevance","timestamp":"..."}
 *
 * ⚠️ 此模块采用 append-only + 定期压缩模式，所有 try-catch 兜底。
 */
import fs from "node:fs";
import path from "node:path";
// ──────────────────────────── Constants ────────────────────────────
const FEEDBACK_FILE = ".feedback.jsonl";
const CURRENT_VERSION = 1;
const MAX_UNCOMPRESSED = 1000; // after 1k entries, compress: keep only last 500
const COMPRESSED_TARGET = 500;
const MAX_TAG_HISTORY = 10;
// ──────────────────────────── Main Class ────────────────────────────
export class FeedbackTracker {
    baseDir;
    filePath;
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.filePath = path.join(baseDir, FEEDBACK_FILE);
        // Ensure dir exists
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        catch { /* best effort */ }
    }
    /** Record a single feedback entry (append-only) */
    record(entry) {
        try {
            const fullEntry = {
                ...entry,
                timestamp: new Date().toISOString(),
                version: CURRENT_VERSION,
            };
            fs.appendFileSync(this.filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
            // Check if compression is needed
            const lineCount = this.countLines();
            if (lineCount > MAX_UNCOMPRESSED) {
                this.compress();
            }
        }
        catch { /* best effort */ }
    }
    /** Read all feedback entries (most recent first) */
    readAll(limit = 50) {
        try {
            if (!fs.existsSync(this.filePath))
                return [];
            const content = fs.readFileSync(this.filePath, "utf-8");
            const lines = content.trim().split("\n").filter(Boolean).reverse();
            const entries = [];
            for (const line of lines.slice(0, limit)) {
                try {
                    entries.push(JSON.parse(line));
                }
                catch { /* skip malformed lines */ }
            }
            return entries;
        }
        catch {
            return [];
        }
    }
    /** Get aggregated feedback statistics */
    getStats() {
        const entries = this.readAll(1000);
        const stats = {
            total: entries.length,
            corrections: 0,
            praises: 0,
            ignores: 0,
            topTags: [],
            recentByTag: {},
        };
        const tagCounts = new Map();
        const recentByTag = {};
        for (const e of entries) {
            if (e.type === "correction")
                stats.corrections++;
            else if (e.type === "praise")
                stats.praises++;
            else if (e.type === "ignore")
                stats.ignores++;
            tagCounts.set(e.tag, (tagCounts.get(e.tag) || 0) + 1);
            if (!recentByTag[e.tag])
                recentByTag[e.tag] = [];
            recentByTag[e.tag].push(e);
        }
        stats.topTags = [...tagCounts.entries()]
            .sort(([_, a], [__, b]) => b - a)
            .slice(0, 5)
            .map(([tag, count]) => ({ tag, count }));
        stats.recentByTag = recentByTag;
        return stats;
    }
    /** Learn from feedback: generate adjustment suggestions */
    learn() {
        const stats = this.getStats();
        const suggestions = [];
        // If many memory corrections → suggest adjusting extraction focus
        const memoryCorrections = stats.recentByTag.memory?.filter(e => e.type === "correction") || [];
        if (memoryCorrections.length >= 3) {
            const commonPatterns = this.findCommonPatterns(memoryCorrections);
            if (commonPatterns.length > 0) {
                suggestions.push(`记忆提取建议: 最近有 ${memoryCorrections.length} 条纠错，`
                    + `高频模式: ${commonPatterns.slice(0, 3).join("、")}`);
            }
        }
        // If many tone corrections → suggest adjusting response style
        const toneCorrections = stats.recentByTag.tone?.filter(e => e.type === "correction") || [];
        if (toneCorrections.length >= 2) {
            suggestions.push(`语气调整建议: 最近有 ${toneCorrections.length} 条语气相关反馈`);
        }
        // If high praise ratio → confidence boost
        if (stats.total > 5 && stats.praises / stats.total > 0.5) {
            suggestions.push("正面反馈占比高，继续当前策略");
        }
        return {
            totalFeedback: stats.total,
            correctionRate: stats.total > 0 ? (stats.corrections / stats.total * 100).toFixed(1) + "%" : "0%",
            suggestions,
            topTags: stats.topTags,
        };
    }
    // ── Private ──
    countLines() {
        try {
            if (!fs.existsSync(this.filePath))
                return 0;
            const content = fs.readFileSync(this.filePath, "utf-8");
            return content.trim().split("\n").filter(Boolean).length;
        }
        catch {
            return 0;
        }
    }
    /** Compress: keep only the most recent COMPRESSED_TARGET entries */
    compress() {
        try {
            const entries = this.readAll(COMPRESSED_TARGET + 100);
            const toKeep = entries.slice(0, COMPRESSED_TARGET).reverse();
            fs.writeFileSync(this.filePath, toKeep.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
        }
        catch { /* best effort */ }
    }
    /** Find common patterns in correction entries */
    findCommonPatterns(entries) {
        // Simple approach: look for frequently repeated original keywords
        const wordFreq = new Map();
        for (const e of entries) {
            const words = e.original.split(/[\s\p{P}]+/u).filter(w => w.length > 1);
            for (const w of words) {
                wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
            }
        }
        return [...wordFreq.entries()]
            .sort(([_, a], [__, b]) => b - a)
            .filter(([_, c]) => c > 1)
            .slice(0, 5)
            .map(([word]) => word);
    }
}
