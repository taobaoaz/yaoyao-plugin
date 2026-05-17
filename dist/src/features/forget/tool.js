/**
 * features/forget/tool.ts — memory_forget tool (modular).
 */
import * as path from "node:path";
import fs from "node:fs";
import { withErrorHandling } from "../../tools/common.js";
export function createForgetTool(store, db) {
    return {
        id: "memory_forget",
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete memory entries matching a keyword or date. Use to remove outdated or incorrect memories.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Keyword to match (deletes matching entries)", default: "" },
                date: { type: "string", description: "Date YYYY-MM-DD to delete an entire day", default: "" },
            },
            required: [],
            anyOf: [
                { required: ["query"] },
                { required: ["date"] },
            ],
        },
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query ?? "").trim();
            const date = String(params.date ?? "").trim();
            if (!query && !date) {
                return { content: [{ type: "text", text: "请提供要删除的关键词（query）或日期（date）。" }] };
            }
            if (date) {
                const fp = path.join(store.baseDir, `${date}.md`);
                let msg = "";
                // 先删 DB（可回滚），再删文件，避免文件已删但 DB 失败造成 orphan
                const deleted = db.deleteByDate(date);
                msg += `FTS5 索引中删除了 ${deleted} 条记录。`;
                if (fs.existsSync(fp)) {
                    try {
                        fs.unlinkSync(fp);
                        msg += ` ✅ 已删除 ${date}.md 文件。`;
                    }
                    catch (unlinkErr) {
                        msg += ` ⚠️ 文件删除失败: ${unlinkErr.message}`;
                    }
                }
                else {
                    msg += ` 📄 ${date}.md 文件不存在（跳过）。`;
                }
                return { content: [{ type: "text", text: msg }] };
            }
            // 先删 DB（可回滚），再改文件，避免文件已改但 DB 失败造成数据不一致
            const ftsDeleted = db.deleteByKeyword(query);
            const files = store.listFiles().filter(f => f.type === "daily");
            let fileDeleted = 0;
            for (const f of files) {
                const content = store.readFile(f.path);
                if (!content)
                    continue;
                const lines = content.split("\n");
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
                    try {
                        fs.writeFileSync(f.path, filtered.join("\n"), "utf-8");
                    }
                    catch (writeErr) {
                        console.error(`[yaoyao-memory:forget] Failed to write ${f.path}: ${writeErr.message}`);
                        continue;
                    }
                }
            }
            return { content: [{ type: "text", text: (fileDeleted > 0 || ftsDeleted > 0)
                            ? `✅ 已删除 ${fileDeleted} 条文件记录 + ${ftsDeleted} 条索引记录（包含 "${query}"）。`
                            : `没有找到包含 "${query}" 的记忆。` }]
            };
        }),
    };
}
