/**
 * memory_import tool — 记忆导入
 *
 * 从 JSONL 格式的数据中导入记忆。
 * 每行一个 JSON 对象：{"date":"...","user_text":"...","asst_text":"..."}
 *
 * JSONL 数据可来自 memory_export 的输出，或其他兼容格式。
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { withErrorHandling } from "./common.js";
const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");
function tryLoadVec(db) {
    try {
        const sqliteVec = _require("sqlite-vec");
        sqliteVec.load(db);
        return true;
    }
    catch {
        return false;
    }
}
export function createImportTool(store) {
    return {
        name: "memory_import",
        label: "Import Memories",
        description: "从 JSONL 格式的数据中导入记忆到数据库。每行一条 JSON：{\"date\":\"...\",\"user_text\":\"...\",\"asst_text\":\"...\"}。支持来自 memory_export 的输出。",
        parameters: {
            type: "object",
            properties: {
                jsonl: {
                    type: "string",
                    description: "JSONL 格式的记忆数据（每行一条 JSON 对象）",
                },
                source: {
                    type: "string",
                    description: "备用：JSONL 文件路径（本地文件路径）",
                    default: "",
                },
                dryRun: {
                    type: "boolean",
                    description: "设为 true 则只验证不写入",
                    default: false,
                },
            },
            required: ["jsonl"],
        },
        execute: withErrorHandling(async (_id, params) => {
            let jsonlData = String(params.jsonl || "");
            const sourceFile = String(params.source || "");
            const dryRun = params.dryRun === true;
            // 从文件读取
            if (!jsonlData && sourceFile) {
                if (!fs.existsSync(sourceFile)) {
                    return { content: [{ type: "text", text: `文件不存在: ${sourceFile}` }] };
                }
                jsonlData = fs.readFileSync(sourceFile, "utf-8");
            }
            if (!jsonlData.trim()) {
                return { content: [{ type: "text", text: "请提供要导入的 JSONL 数据。" }] };
            }
            // 解析 JSONL
            const lines = jsonlData.split("\n").filter(l => l.trim());
            const entries = [];
            const errors = [];
            for (let i = 0; i < lines.length; i++) {
                try {
                    const parsed = JSON.parse(lines[i]);
                    if (!parsed.date) {
                        errors.push(`第 ${i + 1} 行缺少 date 字段`);
                        continue;
                    }
                    if (!parsed.user_text && !parsed.asst_text) {
                        errors.push(`第 ${i + 1} 行至少需要 user_text 或 asst_text`);
                        continue;
                    }
                    entries.push({
                        date: String(parsed.date).slice(0, 10),
                        user_text: String(parsed.user_text || ""),
                        asst_text: String(parsed.asst_text || ""),
                    });
                }
                catch (e) {
                    errors.push(`第 ${i + 1} 行 JSON 解析失败: ${e.message}`);
                }
            }
            if (errors.length > 0 && entries.length === 0) {
                return { content: [{ type: "text", text: `❌ 导入数据格式错误，无法解析任何条目：\n\n${errors.join("\n")}` }] };
            }
            if (entries.length === 0) {
                return { content: [{ type: "text", text: "未发现可导入的记忆条目。" }] };
            }
            // 干跑模式：只验证
            if (dryRun) {
                const parts = [
                    `## 导入预览（干跑模式）`,
                    `有效条目: ${entries.length}`,
                    `格式错误: ${errors.length}`,
                    ``,
                ];
                if (entries.length > 0) {
                    parts.push(`示例（前 3 条）：`);
                    for (const e of entries.slice(0, 3)) {
                        parts.push(`- [${e.date}] ${e.user_text || "(无)"} | ${e.asst_text || "(无)"}`);
                    }
                }
                if (errors.length > 0) {
                    parts.push(``, `警告：`, ...errors.slice(0, 5));
                }
                return { content: [{ type: "text", text: parts.join("\n") }] };
            }
            // 正式写入 DB
            const dbPath = path.join(store.baseDir, ".yaoyao.db");
            const db = new DatabaseSync(dbPath, { allowExtension: true });
            try {
                tryLoadVec(db);
                db.exec("PRAGMA journal_mode = WAL");
                db.exec("PRAGMA busy_timeout = 5000");
                // 确保表存在
                db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
                    "date, user_text, asst_text, " +
                    "tokenize='unicode61'" +
                    ")");
                db.exec("CREATE TABLE IF NOT EXISTS memory_meta (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                    "date TEXT NOT NULL, " +
                    "user_text TEXT, " +
                    "asst_text TEXT, " +
                    "created_at TEXT DEFAULT (datetime('now'))" +
                    ")");
                const insertedMeta = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
                const insertedFts = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
                let successCount = 0;
                db.exec("BEGIN TRANSACTION");
                for (const entry of entries) {
                    const r = insertedMeta.run(entry.date, entry.user_text, entry.asst_text);
                    const rowId = Number(r.lastInsertRowid);
                    insertedFts.run(rowId, entry.date, entry.user_text, entry.asst_text);
                    successCount++;
                }
                db.exec("COMMIT");
                const total = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get();
                const parts = [
                    `## 导入完成`,
                    `成功导入: ${successCount} 条`,
                    `现有记忆总数: ${total.c} 条`,
                    `格式错误: ${errors.length} 条`,
                ];
                return { content: [{ type: "text", text: parts.join("\n") }] };
            }
            finally {
                try {
                    db.close();
                }
                catch { /* ignore */ }
            }
        }),
    };
}
