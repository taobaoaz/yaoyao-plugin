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
        description: "Delete memory entries matching a keyword or date. Use to remove outdated or incorrect memories.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Keyword to match (deletes matching entries)", default: "" },
                date: { type: "string", description: "Date YYYY-MM-DD to delete an entire day", default: "" },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const date = String(params.date ?? "").trim();
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
            // Delete by keyword — block-level deletion to preserve markdown structure
            const files = store.listFiles().filter(f => f.type === "daily");
            let fileDeleted = 0;
            for (const f of files) {
                const content = store.readFile(f.path);
                if (!content)
                    continue;
                const lines = content.split("\n");
                // First pass: identify which ###-blocks contain the keyword
                const matchingBlocks = new Set();
                let currentBlock = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (/^###\s+/.test(lines[i])) {
                        currentBlock = i;
                    }
                    if (currentBlock >= 0 && lines[i].toLowerCase().includes(query.toLowerCase())) {
                        matchingBlocks.add(currentBlock);
                    }
                }
                // Second pass: output only non-matching blocks
                const filtered = [];
                let skipBlock = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (/^###\s+/.test(lines[i])) {
                        skipBlock = matchingBlocks.has(i) ? i : -1;
                    }
                    if (skipBlock < 0) {
                        filtered.push(lines[i]);
                    }
                }
                if (filtered.length !== lines.length) {
                    fileDeleted += matchingBlocks.size;
                    fs.writeFileSync(f.path, filtered.join("\n"), "utf-8");
                }
            }
            const ftsDeleted = db.deleteByKeyword(query);
            return { content: [{ type: "text", text: (fileDeleted > 0 || ftsDeleted > 0)
                            ? `✅ 已删除 ${fileDeleted} 条文件记录 + ${ftsDeleted} 条索引记录（包含 "${query}"）。`
                            : `没有找到包含 "${query}" 的记忆。` }]
            };
        }),
    };
}
