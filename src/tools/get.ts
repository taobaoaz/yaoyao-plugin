import * as path from "node:path";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createGetTool(store: MemoryStore, _db: DBBridge): ToolRegistration {
  return {
    name: "memory_get",
    label: "Yaoyao Memory Get",
    description: "Read a memory file by filename or date. Returns the full file contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Memory file path (e.g., '2026-05-02.md' or absolute path)" },
        from: { type: "number", description: "Start reading from this line (1-indexed)" },
        lines: { type: "number", description: "Number of lines to read" },
      },
      required: ["path"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const rawPath = String(params.path ?? "");
      const resolved = rawPath.startsWith("/")
        ? path.resolve(rawPath)
        : path.resolve(store.baseDir, rawPath);
      if (!resolved.startsWith(store.baseDir)) {
        return { content: [{ type: "text", text: `⛔ 拒绝读取记忆目录之外的文件: ${rawPath}` }] };
      }

      const content = store.readFile(resolved);
      if (content === null) {
        return { content: [{ type: "text", text: `文件未找到: ${params.path}` }] };
      }

      if (params.from !== undefined) {
        const allLines = content.split("\n");
        const start = Math.max(0, (Number(params.from) || 1) - 1);
        const count = params.lines ? Number(params.lines) : allLines.length;
        return { content: [{ type: "text", text: allLines.slice(start, start + count).join("\n") }] };
      }

      return { content: [{ type: "text", text: content }] };
    }),
  };
}
