import type { MemoryStore } from "../utils/memory-store.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createListTool(store: MemoryStore): ToolRegistration {
  return {
    name: "memory_list",
    label: "Memory List",
    description: "List available memory files with metadata (type, date, size, modified time).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["daily", "memory", "archive"], description: "Filter by file type" },
        limit: { type: "number", description: "Max results (default: 20)", default: 20 },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
      let files = store.listFiles();
      if (params.type && typeof params.type === "string") {
        files = files.filter(f => f.type === params.type);
      }
      files = files.slice(0, limit);
      if (files.length === 0) return { content: [{ type: "text", text: "没有找到记忆文件。" }] };

      const lines = files.map(f => {
        const date = new Date(f.modified).toISOString().slice(0, 19).replace("T", " ");
        const sizeKB = (f.size / 1024).toFixed(1);
        return `[${f.type}] ${f.filename} (${sizeKB}KB, ${date})`;
      });
      return { content: [{ type: "text", text: `记忆文件列表 (共 ${lines.length} 个):\n\n${lines.join("\n")}` }] };
    }),
  };
}
