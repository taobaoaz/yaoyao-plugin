/**
 * memory_summarize — compress long conversations into key-point summaries.
 * No LLM — extracts user_text, deduplicates, produces a condensed summary.
 */
import { withErrorHandling } from "./common.js";

export function createSummarizeTool(db, store) {
  return {
    name: "memory_summarize",
    label: "Memory Summarize",
    description:
      "📝 将指定日期的记忆压缩为关键点摘要。读取 memory_meta 记录，去重合并后输出。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "日期（默认今天，格式 YYYY-MM-DD）",
        },
        maxLength: {
          type: "number",
          description: "摘要最大长度（默认 500）",
          default: 500,
        },
      },
    },
    execute: withErrorHandling(async (_id, params) => {
      const today = new Date().toISOString().slice(0, 10);
      const date = String(params.date || today);
      const maxLength = Math.max(Number(params.maxLength) || 500, 100);

      // Try reading from store's daily file first
      let fileContent = "";
      if (store && store.baseDir) {
        try {
          const path = require("path");
          const fs = require("fs");
          const filePath = path.join(store.baseDir, `${date}.md`);
          if (fs.existsSync(filePath)) {
            fileContent = fs.readFileSync(filePath, "utf-8");
          }
        } catch { /* best effort */ }
      }

      // Also try db queryMeta for that date
      let dbRows = [];
      try {
        dbRows = db.queryMeta({ dateFrom: date, dateTo: date, limit: 200 });
      } catch { /* best effort */ }

      // Combine sources
      const texts = [];
      if (fileContent) {
        // Split into lines, filter empty
        const lines = fileContent.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("#"));
        texts.push(...lines);
      }
      for (const r of dbRows) {
        const text = `${r.user_text || ""} ${r.asst_text || ""}`.trim();
        if (text) texts.push(text);
      }

      if (texts.length === 0) {
        return { content: [{ type: "text", text: `${date} 没有记忆记录。` }] };
      }

      // Deduplicate by normalizing whitespace
      const seen = new Set();
      const unique = [];
      for (const t of texts) {
        const norm = t.replace(/\s+/g, " ").trim().toLowerCase();
        if (!seen.has(norm) && norm.length > 5) {
          seen.add(norm);
          unique.push(t);
        }
      }

      // Build summary
      const header = `# 📝 ${date} 记忆摘要\n\n`;
      let body = unique.map((t, i) => `${i + 1}. ${t}`).join("\n");
      if (body.length > maxLength) {
        body = body.slice(0, maxLength) + "\n...（已截断）";
      }
      const footer = `\n\n---\n共 ${unique.length} 条去重记录（原始 ${texts.length} 条）`;
      return { content: [{ type: "text", text: header + body + footer }] };
    }),
  };
}
