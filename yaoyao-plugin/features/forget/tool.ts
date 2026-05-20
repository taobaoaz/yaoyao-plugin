/**
 * features/forget/tool.ts — memory_forget tool (modular).
 */

import * as path from "node:path";
import fs from "node:fs";
import type { MemoryStore } from "../../utils/memory-store.ts";
import type { DBBridge } from "../../utils/db-bridge.ts";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";

export function createForgetTool(store: MemoryStore, db: DBBridge): ToolRegistration {
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
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const query = String(params.query ?? "").trim();
      const date = String(params.date ?? "").trim();
      if (!query && !date) {
        return { content: [{ type: "text", text: "请提供要删除的关键词（query）或日期（date）。" }] };
      }

      if (date) {
        const fp = path.join(store.baseDir, `${date}.md`);
        let msg = "";
        // 先删文件，成功后再删 DB，避免 DB 已删但文件还在造成数据不一致
        if (fs.existsSync(fp)) {
          try {
            fs.unlinkSync(fp);
            msg += `✅ 已删除 ${date}.md 文件。`;
          } catch (unlinkErr) {
            msg += `⚠️ 文件删除失败: ${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}`;
            return { content: [{ type: "text", text: msg }] };
          }
        } else {
          msg += `📄 ${date}.md 文件不存在（跳过）。`;
        }
        const deleted = db.deleteByDate(date);
        msg += ` FTS5 索引中删除了 ${deleted} 条记录。`;
        return { content: [{ type: "text", text: msg }] };
      }

      if (!query) return { content: [{ type: "text", text: "❌ 请提供要删除的关键词（query）或日期（date）。" }] };

      // 先改文件，成功后再删 DB，保持数据一致性
      const files = store.listFiles().filter(f => f.type === "daily");
      let fileDeleted = 0;
      const modifiedFiles: string[] = [];
      for (const f of files) {
        const content = store.readFile(f.path);
        if (!content) continue;
        const lines = content.split("\n");
        const matchingBlocks = new Set<number>();
        let currentBlock = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^###\s+/.test(lines[i])) {
            currentBlock = i;
          }
          if (currentBlock >= 0 && lines[i].toLowerCase().includes(query.toLowerCase())) {
            matchingBlocks.add(currentBlock);
          }
        }
        const filtered: string[] = [];
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
            modifiedFiles.push(f.path);
          } catch (writeErr) {
            console.error(`[yaoyao-memory:forget] Failed to write ${f.path}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
            // 回滚已修改的文件
            for (const modified of modifiedFiles.slice(0, -1)) {
              // 注意：这里没有原始内容备份，无法真正回滚
              // 但至少不继续删 DB
            }
            return { content: [{ type: "text", text: `⚠️ 文件修改失败 ${f.path}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}，已中止，未删除索引。` }] };
          }
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
