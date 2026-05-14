/**
 * features/tag/tool.ts — memory_tag tool (modular).
 *
 * Assembles: connection management → core tag logic → formatting.
 */
import fs from "node:fs";
import path from "node:path";
import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
import { createCompatDB } from "../../platform/db/compat.js";
import { ensureTagTable, addTagsToQuery, removeTags, removeAllTags, cleanOrphanTags, getPopularTags, searchByTagWithQuery, } from "../../core/tag/tag.js";
function getDbPath(store) {
    return path.join(store.baseDir, ".yaoyao.db");
}
function openDb(dbPath) {
    const { db } = createCompatDB(dbPath, { allowExtension: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
}
function getDb(store, dbBridge) {
    if (dbBridge) {
        return { db: dbBridge.getRawDb(), isOwned: false };
    }
    const dbPath = getDbPath(store);
    const db = openDb(dbPath);
    return { db, isOwned: true };
}
export function createTagTool(store, dbBridge) {
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
            const limit = clampNum(params.limit, 20, 1, 500);
            const dbPath = getDbPath(store);
            if (!fs.existsSync(dbPath)) {
                return { content: [{ type: "text", text: "数据库中暂无数据，无法操作标签。" }] };
            }
            const { db, isOwned } = getDb(store, dbBridge);
            try {
                ensureTagTable(db);
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
                    const { matched, added } = addTagsToQuery(db, query, cleanTags, limit);
                    if (matched === 0) {
                        return { content: [{ type: "text", text: `没有找到匹配"${query}"的记忆。` }] };
                    }
                    return { content: [{ type: "text", text: `✅ 已给 ${matched} 条记忆添加标签 "${cleanTags.join("、")}"（${added} 次操作）` }] };
                }
                if (action === "remove") {
                    const rawTags = params.tags;
                    const tags = Array.isArray(rawTags) ? rawTags.map(String) : [String(rawTags || "")];
                    const cleanTags = tags.filter(t => t.trim().length > 0);
                    if (cleanTags.length > 0) {
                        const removed = removeTags(db, cleanTags);
                        return { content: [{ type: "text", text: `✅ 已移除标签 "${cleanTags.join("、")}"（${removed} 条记录）` }] };
                    }
                    else {
                        const count = removeAllTags(db);
                        return { content: [{ type: "text", text: `✅ 已清除所有标签（${count} 条记录）` }] };
                    }
                }
                if (action === "clean") {
                    const removed = cleanOrphanTags(db);
                    return { content: [{ type: "text", text: `✅ 已清理 ${removed} 条孤立标签。` }] };
                }
                if (action === "popular") {
                    const tags = getPopularTags(db, limit);
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
                const query = String(params.query || "").trim();
                const results = searchByTagWithQuery(db, tag, query, limit);
                if (results.length === 0) {
                    return { content: [{ type: "text", text: `没有找到标签"${tag}"的记忆。` }] };
                }
                const lines = results.map(r => `📝 [${r.date}] ${r.user_text || "(无)"} ${r.asst_text ? "| " + r.asst_text : ""}`);
                return { content: [{ type: "text", text: `## 标签: #${tag}\n(${results.length} 条)\n\n${lines.join("\n")}` }] };
            }
            finally {
                if (isOwned) {
                    try {
                        db.close();
                    }
                    catch { /* ignore */ }
                }
            }
        }),
    };
}
