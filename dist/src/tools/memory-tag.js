/**
 * memory_tag tool — 记忆标签系统
 *
 * 给记忆条目打标签，按标签搜索和过滤。
 * 使用独立的 tags 表（零侵入，不影响主 DB 结构）。
 *
 * 工具名: memory_tag
 * 使用:
 *   memory_tag({ action: "add", query: "项目", tags: ["重要", "工作"] })
 *   memory_tag({ action: "search", tag: "重要" })
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { withErrorHandling } from "./common.js";
const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");
function ensureTagTable(db) {
    db.exec("CREATE TABLE IF NOT EXISTS memory_tags (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "memory_id INTEGER NOT NULL, " +
        "tag TEXT NOT NULL COLLATE NOCASE, " +
        "created_at TEXT DEFAULT (datetime('now'))" +
        ")");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tags_memory ON memory_tags(memory_id)");
}
function getDbPath(store) {
    return path.join(store.baseDir, ".yaoyao.db");
}
function openDb(dbPath) {
    const db = new DatabaseSync(dbPath, { allowExtension: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
}
export function createTagTool(store) {
    return {
        name: "memory_tag",
        label: "Tag Memories",
        description: "给记忆条目打标签、移除标签、按标签搜索。标签不区分大小写。",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["add", "remove", "search", "popular", "clean"],
                    description: "操作类型：add=添加标签，remove=移除标签，search=按标签搜索，popular=热门标签，clean=清理空标签",
                    default: "search",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "要添加或移除的标签列表（仅 add/remove 操作需要）",
                },
                tag: {
                    type: "string",
                    description: "搜索用的标签（仅 search 操作需要）",
                },
                query: {
                    type: "string",
                    description: "搜索记忆关键词（配合 tag 使用，缩小范围）",
                    default: "",
                },
                limit: {
                    type: "number",
                    description: "返回结果数量限制（默认 20）",
                    default: 20,
                },
            },
            required: ["action"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action || "search");
            const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
            const dbPath = getDbPath(store);
            if (!fs.existsSync(dbPath)) {
                return { content: [{ type: "text", text: "数据库中暂无数据，无法操作标签。" }] };
            }
            const db = openDb(dbPath);
            try {
                ensureTagTable(db);
                // ── Add tags ──
                if (action === "add") {
                    const rawTags = params.tags;
                    const query = String(params.query || "").trim();
                    if (!query && !rawTags) {
                        return { content: [{ type: "text", text: "请提供要添加的标签和匹配的记忆关键词。" }] };
                    }
                    const tags = Array.isArray(rawTags) ? rawTags.map(String) : [String(rawTags || "")];
                    const cleanTags = tags.filter(t => t.trim().length > 0);
                    if (cleanTags.length === 0) {
                        return { content: [{ type: "text", text: "标签不能为空。" }] };
                    }
                    // 搜索匹配的记忆条目
                    const ftsStmt = db.prepare("SELECT id FROM memory_meta WHERE user_text LIKE ? OR asst_text LIKE ? LIMIT ?");
                    const likeQ = `%${query}%`;
                    const rows = ftsStmt.all(likeQ, likeQ, limit);
                    if (rows.length === 0) {
                        return { content: [{ type: "text", text: `没有找到匹配"${query}"的记忆。` }] };
                    }
                    const insertTag = db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
                    let added = 0;
                    db.exec("BEGIN");
                    for (const row of rows) {
                        for (const tag of cleanTags) {
                            try {
                                insertTag.run(row.id, tag.trim());
                                added++;
                            }
                            catch { /* ignore duplicates */ }
                        }
                    }
                    db.exec("COMMIT");
                    return { content: [{ type: "text", text: `✅ 已给 ${rows.length} 条记忆添加标签 "${cleanTags.join("、")}"（${added} 次操作）` }] };
                }
                // ── Remove tags ──
                if (action === "remove") {
                    const rawTags = params.tags;
                    const tags = Array.isArray(rawTags) ? rawTags.map(String) : [String(rawTags || "")];
                    const cleanTags = tags.filter(t => t.trim().length > 0);
                    if (cleanTags.length > 0) {
                        const delStmt = db.prepare("DELETE FROM memory_tags WHERE tag = ?");
                        let removed = 0;
                        db.exec("BEGIN");
                        for (const tag of cleanTags) {
                            const info = delStmt.run(tag.trim());
                            removed += Number(info.changes);
                        }
                        db.exec("COMMIT");
                        return { content: [{ type: "text", text: `✅ 已移除标签 "${cleanTags.join("、")}"（${removed} 条记录）` }] };
                    }
                    else {
                        // 移除所有标签
                        const count = db.prepare("SELECT COUNT(*) as c FROM memory_tags").get();
                        db.exec("DELETE FROM memory_tags");
                        return { content: [{ type: "text", text: `✅ 已清除所有标签（${count.c} 条记录）` }] };
                    }
                }
                // ── Clean orphan tags ──
                if (action === "clean") {
                    const del = db.prepare("DELETE FROM memory_tags WHERE memory_id NOT IN (SELECT id FROM memory_meta)");
                    const info = del.run();
                    return { content: [{ type: "text", text: `✅ 已清理 ${info.changes} 条孤立标签。` }] };
                }
                // ── Popular tags ──
                if (action === "popular") {
                    const tagStmt = db.prepare("SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY count DESC LIMIT ?");
                    const tags = tagStmt.all(limit);
                    if (tags.length === 0) {
                        return { content: [{ type: "text", text: "暂无标签。" }] };
                    }
                    const lines = tags.map(t => `#${t.tag} (${t.count} 条)`);
                    return { content: [{ type: "text", text: `## 热门标签\n\n${lines.join("\n")}` }] };
                }
                // ── Search by tag ──
                const tag = String(params.tag || "").trim().toLowerCase();
                if (!tag) {
                    return { content: [{ type: "text", text: "请输入要搜索的标签。" }] };
                }
                let results;
                const query = String(params.query || "").trim();
                if (query) {
                    const stmt = db.prepare("SELECT t.memory_id, t.tag, m.user_text, m.asst_text, m.date " +
                        "FROM memory_tags t " +
                        "JOIN memory_meta m ON t.memory_id = m.id " +
                        "WHERE t.tag = ? AND (m.user_text LIKE ? OR m.asst_text LIKE ?) " +
                        "ORDER BY m.date DESC LIMIT ?");
                    const likeQ = `%${query}%`;
                    results = stmt.all(tag, likeQ, likeQ, limit);
                }
                else {
                    const stmt = db.prepare("SELECT t.memory_id, t.tag, m.user_text, m.asst_text, m.date " +
                        "FROM memory_tags t " +
                        "JOIN memory_meta m ON t.memory_id = m.id " +
                        "WHERE t.tag = ? " +
                        "ORDER BY m.date DESC LIMIT ?");
                    results = stmt.all(tag, limit);
                }
                if (results.length === 0) {
                    return { content: [{ type: "text", text: `没有找到标签"${tag}"的记忆。` }] };
                }
                const lines = results.map(r => `📝 [${r.date}] ${r.user_text || "(无)"} ${r.asst_text ? "| " + r.asst_text : ""}`);
                return { content: [{ type: "text", text: `## 标签: #${tag}\n(${results.length} 条)\n\n${lines.join("\n")}` }] };
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
