/**
 * memory_export tool — 记忆导出
 *
 * 将记忆以 JSONL 格式导出，支持跨设备迁移。
 * 每行一个 JSON 对象：{"date":"...","user_text":"...","asst_text":"..."}
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { withErrorHandling } from "./common.js";
const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");
export function createExportTool(store, dbBridge) {
    return {
        name: "memory_export",
        label: "Export Memories",
        description: "以 JSONL 格式导出记忆数据，支持按日期和关键词筛选。输出可跨设备导入。",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "最大导出条数（1-1000，默认 100）",
                    default: 100,
                },
                dateFrom: {
                    type: "string",
                    description: "起始日期（含），格式 YYYY-MM-DD",
                    default: "",
                },
                dateTo: {
                    type: "string",
                    description: "结束日期（含），格式 YYYY-MM-DD",
                    default: "",
                },
                keyword: {
                    type: "string",
                    description: "关键词过滤（可选，在 user_text 和 asst_text 中匹配）",
                    default: "",
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const limit = Math.min(1000, Math.max(1, Number(params.limit) || 100));
            const dateFrom = String(params.dateFrom || "");
            const dateTo = String(params.dateTo || "");
            const keyword = String(params.keyword || "");
            const dbPath = path.join(store.baseDir, ".yaoyao.db");
            if (!fs.existsSync(dbPath)) {
                return { content: [{ type: "text", text: "数据库中暂无记忆，无法导出。" }] };
            }
            // 复用 DBBridge 连接
            const rawDb = dbBridge ? dbBridge.getRawDb() : new DatabaseSync(dbPath, { allowExtension: true });
            const ownConnection = !dbBridge;
            try {
                // 构建查询
                const conditions = [];
                const bindParams = [];
                if (dateFrom) {
                    conditions.push("date >= ?");
                    bindParams.push(dateFrom);
                }
                if (dateTo) {
                    conditions.push("date <= ?");
                    bindParams.push(dateTo);
                }
                const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
                const stmt = rawDb.prepare(`SELECT date, user_text, asst_text, created_at FROM memory_meta ${whereClause} ORDER BY date DESC, id DESC LIMIT ?`);
                const rows = stmt.all(...bindParams, limit);
                if (rows.length === 0) {
                    return { content: [{ type: "text", text: "没有找到匹配的记忆。" }] };
                }
                // 关键词后过滤
                let filtered = rows;
                if (keyword) {
                    const kw = keyword.toLowerCase();
                    filtered = rows.filter(r => String(r.user_text || "").toLowerCase().includes(kw) ||
                        String(r.asst_text || "").toLowerCase().includes(kw));
                }
                if (filtered.length === 0) {
                    return { content: [{ type: "text", text: `没有找到包含"${keyword}"的记忆。` }] };
                }
                // 构建 JSONL 格式输出
                const jsonlLines = filtered.map(r => JSON.stringify({
                    date: r.date,
                    user_text: r.user_text,
                    asst_text: r.asst_text,
                    created_at: r.created_at,
                }));
                const parts = [
                    `## 记忆导出`,
                    `总条目: ${filtered.length}`,
                    `格式: JSONL（每行一条 JSON）`,
                    ``,
                    "```jsonl",
                    jsonlLines.join("\n"),
                    "```",
                ];
                return { content: [{ type: "text", text: parts.join("\n") }] };
            }
            finally {
                if (ownConnection) {
                    try {
                        rawDb.close();
                    }
                    catch { /* ignore */ }
                }
            }
        }),
    };
}
