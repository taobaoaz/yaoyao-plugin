/**
 * memory_import_oc — Import OpenClaw native memory chunks into Yaoyao FTS5 index.
 *
 * Reads from ~/.openclaw/memory/main.sqlite (chunks table),
 * extracts text content, and indexes into yaoyao's FTS5 + memory_meta.
 *
 * Features:
 * - Incremental: only imports chunks not already indexed (by content hash)
 * - Idempotent: safe to run multiple times
 * - Read-only on source DB (opens with readonly mode)
 * - Progress tracking via memory_config table
 */
import { withErrorHandling } from "./common.js";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
const _require = createRequire(import.meta.url);
function getOCLocation() {
    const defaultPath = path.join(os.homedir(), ".openclaw", "memory", "main.sqlite");
    if (fs.existsSync(defaultPath))
        return defaultPath;
    return null;
}
// SHA-256 content hash for dedup (truncated to 32 chars for key length)
function contentHash(text) {
    return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 32);
}
export function createImportOCTool(store, db) {
    return {
        name: "memory_import_oc",
        label: "Import OpenClaw Chunks",
        description: "📦 将 OpenClaw 原生记忆 chunks 导入 Yaoyao 索引。增量导入，幂等安全，不修改源数据。",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "最多导入条数（默认 500，0=全部）",
                    default: 500,
                },
                dryRun: {
                    type: "boolean",
                    description: "仅预览不实际导入（默认 false）",
                    default: false,
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const limit = Number(params.limit) || 500;
            const dryRun = params.dryRun === true;
            // Find OpenClaw memory DB
            const ocDbPath = getOCLocation();
            if (!ocDbPath) {
                return { content: [{ type: "text", text: "⚪ 未发现 OpenClaw 原生记忆数据（~/.openclaw/memory/main.sqlite 不存在）。无需导入。" }] };
            }
            // Read OpenClaw chunks (readonly)
            let chunks = [];
            try {
                const { DatabaseSync } = _require("node:sqlite");
                const ocDb = new DatabaseSync(ocDbPath, { readOnly: true });
                ocDb.exec("PRAGMA busy_timeout = 3000");
                try {
                    const sql = limit > 0
                        ? "SELECT c.id, c.path, c.text, c.start_line, c.end_line, f.updated_at FROM chunks c LEFT JOIN files f ON c.path = f.path ORDER BY c.id DESC LIMIT ?"
                        : "SELECT c.id, c.path, c.text, c.start_line, c.end_line, f.updated_at FROM chunks c LEFT JOIN files f ON c.path = f.path ORDER BY c.id DESC";
                    const stmt = ocDb.prepare(sql);
                    chunks = limit > 0 ? stmt.all(limit) : stmt.all();
                }
                finally {
                    try {
                        ocDb.close();
                    }
                    catch { /* ignore */ }
                }
            }
            catch (err) {
                return { content: [{ type: "text", text: `❌ 读取 OpenClaw 记忆失败: ${err.message}` }] };
            }
            if (chunks.length === 0) {
                return { content: [{ type: "text", text: "⚪ OpenClaw 记忆库为空，无需导入。" }] };
            }
            // Get last import checkpoint
            const lastImportedId = Number(db.getConfig("oc_import_last_id", "0") || "0");
            // Filter: only import chunks newer than last checkpoint
            const newChunks = chunks.filter((c) => c.id > lastImportedId);
            if (newChunks.length === 0) {
                return { content: [{ type: "text", text: `✅ 已是最新。共 ${chunks.length} 条 chunks，全部已导入。` }] };
            }
            if (dryRun) {
                const sample = newChunks.slice(0, 5).map((c) => `  - [${c.path}:${c.start_line}-${c.end_line}] ${String(c.text || "").slice(0, 80)}...`);
                return { content: [{ type: "text", text: [
                                `📋 预览: 发现 ${newChunks.length} 条新 chunks 可导入`,
                                `来源: ${ocDbPath}`,
                                `最后已导入 ID: ${lastImportedId}`,
                                "",
                                "示例:",
                                ...sample,
                                newChunks.length > 5 ? `...还有 ${newChunks.length - 5} 条` : "",
                                "",
                                "使用 dryRun: false 执行实际导入。",
                            ].join("\n") }] };
            }
            // Import
            let imported = 0;
            let skipped = 0;
            let maxId = lastImportedId;
            const now = new Date().toISOString().slice(0, 10);
            for (const chunk of newChunks) {
                try {
                    const text = String(chunk.text || "").trim();
                    if (text.length < 10) {
                        skipped++;
                        continue;
                    }
                    // Extract date from path (e.g., "memory/2026-05-05.md")
                    const dateMatch = String(chunk.path || "").match(/(\d{4}-\d{2}-\d{2})/);
                    const date = dateMatch ? dateMatch[1] : (chunk.updated_at ? String(chunk.updated_at).slice(0, 10) : now);
                    // Dedup by content hash
                    const hash = contentHash(text);
                    const existing = db.getConfig(`oc_hash_${hash}`, null);
                    if (existing) {
                        skipped++;
                        continue;
                    }
                    // Index into yaoyao
                    const sourceTag = `[oc-import:${chunk.path}:${chunk.start_line}]`;
                    const rowId = db.indexTurn(`${sourceTag} ${text.slice(0, 1900)}`, "", date);
                    if (rowId > 0) {
                        imported++;
                        maxId = Math.max(maxId, chunk.id);
                        // Mark as imported (content hash)
                        db.setConfig(`oc_hash_${hash}`, String(rowId));
                    }
                    else {
                        skipped++;
                    }
                }
                catch {
                    skipped++;
                }
            }
            // Update checkpoint
            db.setConfig("oc_import_last_id", String(maxId));
            return { content: [{ type: "text", text: [
                            `✅ 导入完成`,
                            `来源: OpenClaw 原生记忆 (${ocDbPath})`,
                            `新发现: ${newChunks.length} 条`,
                            `成功导入: ${imported} 条`,
                            `跳过: ${skipped} 条（太短/重复）`,
                            `检查点: last_id=${maxId}`,
                        ].join("\n") }] };
        }),
    };
}
