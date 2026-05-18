import { withErrorHandling } from "../../tools/common.js";
import { handleCheck, handleBoost, handleImportant } from "./handlers.js";
export function createRetainTool(store, db) {
    return {
        id: "memory_retain",
        name: "memory_retain",
        label: "Memory Retain",
        description: "🧠 记忆增强/反遗忘 — 检测重要但长期未被召回的记忆，生成强化建议。防止关键记忆被遗忘。",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["check", "boost", "important"],
                    description: "check=检查遗忘风险, boost=强化指定记忆, important=标记重要记忆",
                },
                keyword: { type: "string", description: "关键词（action=boost/important 时必填）" },
                filename: { type: "string", description: "文件名（action=boost/important 时可选）" },
                reason: { type: "string", description: "标记原因（action=important 时可选）" },
            },
            required: ["action"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action);
            switch (action) {
                case "check":
                    return handleCheck(store, db);
                case "boost": {
                    const keyword = String(params.keyword || "");
                    if (!keyword)
                        return { content: [{ type: "text", text: "❌ action=boost 时 keyword 必填" }] };
                    return handleBoost(store, db, keyword, params.filename ? String(params.filename) : undefined, params.reason ? String(params.reason) : undefined);
                }
                case "important": {
                    const keyword = String(params.keyword || "");
                    if (!keyword)
                        return { content: [{ type: "text", text: "❌ action=important 时 keyword 必填" }] };
                    return handleImportant(store, keyword, params.filename ? String(params.filename) : undefined, params.reason ? String(params.reason) : undefined);
                }
                default:
                    return { content: [{ type: "text", text: `❌ 未知操作: ${action}，支持: check, boost, important` }] };
            }
        }),
    };
}
