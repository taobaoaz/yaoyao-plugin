/**
 * features/note/tool.ts — memory_note tool (modular).
 */
import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
export function createNoteTool(store, db) {
    return {
        id: "memory_note",
        name: "memory_note",
        label: "Memory Quick Note",
        description: "Quickly save a short note to today's memory. Like sticking a Post-it note on your memory wall.",
        parameters: {
            type: "object",
            properties: {
                note: { type: "string", description: "The note content" },
                maxLen: {
                    type: "number",
                    description: "Max note length in chars (default 500)",
                    default: 500,
                },
            },
            required: ["note"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const maxLen = clampNum(params.maxLen, 500, 50, 2000);
            const note = String(params.note ?? "").trim().slice(0, maxLen);
            if (!note)
                return { content: [{ type: "text", text: "请输入笔记内容。" }] };
            const date = new Date().toLocaleDateString("sv-SE");
            const timestamp = new Date().toLocaleString("sv-SE").slice(0, 19).replace("T", " ");
            store.appendToDaily(date, `\n### ${timestamp}\n🗒️ ${note}\n`);
            db.indexTurn(note, "", date);
            return { content: [{ type: "text", text: `📌 笔记已保存到 ${date}.md` }] };
        }),
    };
}
