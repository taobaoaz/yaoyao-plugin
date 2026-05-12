import { withErrorHandling } from "./common.js";
export function createSaveTool(store, db) {
    return {
        name: "memory_save",
        label: "Memory Save",
        description: "💾 Manually save an important memory to long-term storage. Use tags (comma-separated, e.g., 'decision,preference,learning') to categorize. Explicit save vs auto-capture.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "The memory content to save" },
                date: { type: "string", description: "Date string (YYYY-MM-DD). Defaults to today.", default: "" },
                tags: { type: "string", description: "Optional tags (comma-separated) like 'decision,preference,learning'", default: "" },
            },
            required: ["content"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const content = String(params.content ?? "").trim();
            if (!content)
                return { content: [{ type: "text", text: "请输入要保存的记忆内容。" }] };
            const date = params.date ? String(params.date).trim() : new Date().toISOString().slice(0, 10);
            const tags = params.tags ? String(params.tags).trim() : "";
            const tagStr = tags ? ` [${tags}]` : "";
            // Prefix tags as hashtags for FTS5 indexing
            const tagPrefix = tags ? tags.split(',').map(t => `#${t.trim()}`).filter(t => t.length > 1).join(' ') + ' ' : '';
            const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
            const entry = `\n### ${timestamp}\n💾 ${content}${tagStr}\n`;
            store.appendToDaily(date, entry);
            // Bug #13: Index with placeholder instead of empty string
            const rowId = db.indexTurn(`${tagPrefix}${content}`, "[空内容]", date);
            return { content: [{ type: "text", text: `✅ 记忆已保存到 ${date}.md\n行号: ${rowId > 0 ? rowId : "索引失败"}` }] };
        }),
    };
}
