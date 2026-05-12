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
        description: "📥 Import memories from JSONL format (one JSON object per line: date, user_text, asst_text). Compatible with memory_export output. Supports dry-run validation.",
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
                sourceType: {
                    type: "string",
                    enum: ["jsonl", "directory"],
                    description: "导入源类型：jsonl=从 JSONL 文件导入, directory=从目录批量导入 md 文件",
                    default: "jsonl",
                },
                sourcePath: {
                    type: "string",
                    description: "源路径（JSONL 文件路径或目录路径）",
                    default: "",
                },
                dryRun: {
                    type: "boolean",
                    description: "设为 true 则只验证不写入",
                    default: false,
                },
            },
            required: [],
        },
        execute: withErrorHandling(async (_id, params) => {
            let jsonlData = String(params.jsonl || "");
            const sourceFile = String(params.source || "");
            const dryRun = params.dryRun === true;
            const sourceType = String(params.sourceType || "jsonl");
            const sourcePath = String(params.sourcePath || "");

            // ── Directory import mode ──
            if (sourceType === "directory") {
                const dirPath = sourcePath || store.baseDir;
                if (!fs.existsSync(dirPath)) {
                    return { content: [{ type: "text", text: `❌ 目录不存在: ${dirPath}` }] };
                }
                const mdFiles = fs.readdirSync(dirPath).filter(f => /\.md$/i.test(f));
                if (mdFiles.length === 0) {
                    return { content: [{ type: "text", text: "⚪ 目录下没有 .md 文件可导入。" }] };
                }
                if (dryRun) {
                    const sample = mdFiles.slice(0, 5).map(f => `  - ${f}`);
                    return { content: [{ type: "text", text: [
                        `📋 预览: 发现 ${mdFiles.length} 个 .md 文件`,
                        `目录: ${dirPath}`,
                        "",
                        ...sample,
                        mdFiles.length > 5 ? `...还有 ${mdFiles.length - 5} 个` : "",
                        "",
                        "使用 dryRun: false 执行实际导入。",
                    ].join("\n") }] };
                }
                // Parse and import each md file
                const dbPath2 = path.join(store.baseDir, ".yaoyao.db");
                const db2 = new DatabaseSync(dbPath2, { allowExtension: true });
                try {
                    tryLoadVec(db2);
                    db2.exec("PRAGMA journal_mode = WAL");
                    db2.exec("PRAGMA busy_timeout = 5000");
                    db2.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(date, user_text, asst_text, tokenize='unicode61')");
                    db2.exec("CREATE TABLE IF NOT EXISTS memory_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, user_text TEXT, asst_text TEXT, created_at TEXT DEFAULT (datetime('now')), source_session TEXT DEFAULT '')");
                    const insMeta = db2.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
                    const insFts = db2.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
                    let count = 0;
                    db2.exec("BEGIN TRANSACTION");
                    for (const f of mdFiles) {
                        try {
                            const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
                            const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
                            const filePath = path.resolve(dirPath, f);
                            if (!filePath.startsWith(path.resolve(dirPath))) continue;
                            const content = fs.readFileSync(filePath, "utf-8");
                            if (content.trim().length < 10) continue;
                            // Parse User/AI pairs from yaoyao format
                            const entries = content.split(/^### /gm).filter(e => e.trim());
                            for (const entry of entries) {
                                const lines = entry.split("\n");
                                let userText = "";
                                let asstText = "";
                                for (const line of lines) {
                                    const userMatch = line.match(/^\*\*User:\*\*\s*(.*)/);
                                    const asstMatch = line.match(/^\*\*AI:\*\*\s*(.*)/);
                                    if (userMatch) userText = userMatch[1].trim();
                                    if (asstMatch) asstText = asstMatch[1].trim();
                                }
                                if (userText || asstText) {
                                    const r = insMeta.run(date, userText, asstText);
                                    insFts.run(Number(r.lastInsertRowid), date, userText, asstText);
                                    count++;
                                }
                            }
                            // If no yaoyao format found, import as single entry
                            if (entries.length === 0 && content.trim().length >= 20) {
                                const text = content.trim().slice(0, 2000);
                                const r = insMeta.run(date, text, "");
                                insFts.run(Number(r.lastInsertRowid), date, text, "");
                                count++;
                            }
                        } catch { /* skip file */ }
                    }
                    db2.exec("COMMIT");
                    const total = db2.prepare("SELECT COUNT(*) as c FROM memory_meta").get();
                    return { content: [{ type: "text", text: [
                        `✅ 目录导入完成`,
                        `目录: ${dirPath}`,
                        `文件数: ${mdFiles.length}`,
                        `导入条目: ${count}`,
                        `现有记忆总数: ${total.c} 条`,
                    ].join("\n") }] };
                } finally {
                    try { db2.close(); } catch {}
                }
            }

            // ── JSONL import mode (original logic) ──
            if (!jsonlData && sourceFile) {
                const resolved = path.resolve(sourceFile);
                const allowedDirs = [store.baseDir, path.join(store.baseDir, ".yaoyao.db")];
                if (!allowedDirs.some(dir => resolved.startsWith(path.resolve(dir)))) {
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
