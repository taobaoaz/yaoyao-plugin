/**
 * Forget Tool — delete memory entries by keyword or date.
 */
import * as path from "node:path";
import fs from "node:fs";
import { withErrorHandling } from "./common.js";
export function createForgetTool(store, db) {
    return {
        name: "memory_forget",
        label: "Memory Forget",
        description: "🗑️ Delete memory entries by keyword or date. ⚠️ IRREVERSIBLE — deleted memories cannot be recovered. Use with caution.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Keyword to match (deletes matching entries)", default: "" },
                date: { type: "string", description: "Date YYYY-MM-DD to delete an entire day", default: "" },
                confirm: { type: "boolean", description: "Set to true to confirm deletion of >10 entries (preview mode otherwise)", default: false },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const date = String(params.date ?? "").trim();
            const confirm = params.confirm === true;
            if (!query && !date) {
                return { content: [{ type: "text", text: "请提供要删除的关键词（query）或日期（date）。" }] };
            }
            // Delete by date
            if (date) {
                const fp = path.join(store.baseDir, `${date}.md`);
                let msg = "";
                if (fs.existsSync(fp)) {
                    fs.unlinkSync(fp);
                    msg += `✅ 已删除 ${date}.md 文件。`;
                }
                else {
                    msg += `📄 ${date}.md 文件不存在（跳过）。`;
                }
                const deleted = db.deleteByDate(date);
                msg += ` FTS5 索引中删除了 ${deleted} 条记录。`;
                return { content: [{ type: "text", text: msg }] };
            }
            // Delete by keyword — preview mode for large deletions
            if (query) {
                try {
                    const matching = db.queryMeta({ limit: 2000 }).filter(r => {
                        const text = `${r.user_text || ""} ${r.asst_text || ""}`;
                        return text.toLowerCase().includes(query.toLowerCase());
                    });
                    if (matching.length > 10 && !confirm) {
                        const preview = matching.slice(0, 5).map(r =>
                            `  [${r.date}] ${(r.user_text || "").slice(0, 60)}...`
                        ).join("\n");
                        return { content: [{ type: "text", text: `⚠️ 匹配到 ${matching.length} 条记录，即将删除的条目预览：\n${preview}\n...共 ${matching.length} 条。\n如确认删除，请加 confirm: true 参数。` }] };
                    }
                } catch { /* preview failed, proceed with delete */ }
            }
            const files = store.listFiles().filter(f => f.type === "daily");
            let fileDeleted = 0;
            for (const f of files) {
                const content = store.readFile(f.path);
                if (!content)
                    continue;
                const lines = content.split("\n");
                const filtered = lines.filter(line => {
                    if (line.startsWith("#") || line.startsWith(">") || line.startsWith("_") || line.startsWith("---"))
                        return true;
                    if (line.toLowerCase().includes(query.toLowerCase())) {
                        fileDeleted++;
                        return false;
                    }
                    return true;
                });
                if (filtered.length !== lines.length)
                    fs.writeFileSync(f.path, filtered.join("\n"), "utf-8");
            }
            const ftsDeleted = db.deleteByKeyword(query);
            return { content: [{ type: "text", text: (fileDeleted > 0 || ftsDeleted > 0)
                            ? `✅ 已删除 ${fileDeleted} 条文件记录 + ${ftsDeleted} 条索引记录（包含 "${query}"）。`
                            : `没有找到包含 "${query}" 的记忆。` }]
            };
        }),
    };
}
