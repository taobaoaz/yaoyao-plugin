/**
 * Note Tool — quick informal notes.
 */
import type { MemoryStore } from "../utils/memory-store.js";
import { clampNum } from "../utils/clamp.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createNoteTool(store: MemoryStore, db: DBBridge): ToolRegistration {
  return {
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
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const maxLen = clampNum(params.maxLen, 500, 50, 2000);
      const note = String(params.note ?? "").trim().slice(0, maxLen);
      if (!note) return { content: [{ type: "text", text: "请输入笔记内容。" }] };

      const date = new Date().toISOString().slice(0, 10);
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      store.appendToDaily(date, `\n### ${timestamp}\n🗒️ ${note}\n`);
      // Bug #13: Index with placeholder instead of empty string
      db.indexTurn(note, "[空内容]", date);
      return { content: [{ type: "text", text: `📌 笔记已保存到 ${date}.md` }] };
    }),
  };
}
