/**
 * features/import/tool.ts — memory_import tool (modular).
 *
 * Assembles: fs safety check → JSONL parse (core) → DB insert (core) → result formatting.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { withErrorHandling } from "../../tools/common.js";
import { createCompatDB } from "../../storage/bridge.js";
import { parseJSONL, batchImport, getTotalCount } from "../../core/import/import.js";
const _require = createRequire(import.meta.url);
function tryLoadVec(db) {
    try {
        const sqliteVec = _require("sqlite-vec");
        sqliteVec.load(db);
        return true;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:import] Operation failed: ${msg}`);
        return false;
    }
}
function ensureSchema(db) {
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
}
export function createImportTool(store) {
    return {
        id: "memory_import",
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
            // 从文件读取 — 安全校验：限制在 baseDir 内
            if (!jsonlData && sourceFile) {
                const allowedDir = path.resolve(store.baseDir);
                const resolved = path.isAbsolute(sourceFile)
                    ? path.resolve(sourceFile)
                    : path.resolve(allowedDir, sourceFile);
                const normalizedResolved = path.normalize(resolved);
                const normalizedAllowed = path.normalize(allowedDir);
                if (!normalizedResolved.startsWith(normalizedAllowed + path.sep) && normalizedResolved !== normalizedAllowed) {
                    return { content: [{ type: "text", text: "⛔ 拒绝读取记忆目录之外的文件" }] };
                }
                if (!fs.existsSync(resolved)) {
                    return { content: [{ type: "text", text: `文件不存在: ${sourceFile}` }] };
                }
                jsonlData = fs.readFileSync(resolved, "utf-8");
            }
            if (!jsonlData.trim()) {
                return { content: [{ type: "text", text: "请提供要导入的 JSONL 数据。" }] };
            }
            // Core: parse JSONL
            const { entries, errors } = parseJSONL(jsonlData);
            if (errors.length > 0 && entries.length === 0) {
                return { content: [{ type: "text", text: `❌ 导入数据格式错误，无法解析任何条目：\n\n${errors.join("\n")}` }] };
            }
            if (entries.length === 0) {
                return { content: [{ type: "text", text: "未发现可导入的记忆条目。" }] };
            }
            // 干跑模式
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
            // 正式写入 DB（独立连接）
            const dbPath = path.join(store.baseDir, ".yaoyao.db");
            const { db } = createCompatDB(dbPath, { allowExtension: true });
            try {
                if (db.enableLoadExtension) {
                    tryLoadVec(db);
                }
                db.exec("PRAGMA journal_mode = WAL");
                db.exec("PRAGMA busy_timeout = 5000");
                db.exec("PRAGMA cache_size = -65536");
                ensureSchema(db);
                const successCount = batchImport(db, entries);
                const total = getTotalCount(db);
                const parts = [
                    `## 导入完成`,
                    `成功导入: ${successCount} 条`,
                    `现有记忆总数: ${total} 条`,
                    `格式错误: ${errors.length} 条`,
                ];
                return { content: [{ type: "text", text: parts.join("\n") }] };
            }
            finally {
                try {
                    db.close();
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory]  ignore : ${msg}`);
                }
            }
        }),
    };
}
