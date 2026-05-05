import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createStatsTool(store: MemoryStore, db: DBBridge): ToolRegistration {
  return {
    name: "memory_stats",
    label: "Memory Stats",
    description: "Get statistics about stored memories: total count, dates breakdown, and database health.",
    parameters: { type: "object", properties: {} },
    execute: withErrorHandling(async () => {
      const dbStats = db.getStats();
      const files = store.listFiles();
      const totalFiles = files.length;
      const dailyFiles = files.filter(f => f.type === "daily").length;
      const totalSizeKB = (files.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1);
      const ftsMemories = (dbStats.totalMemories as number) || 0;

      const lines = [
        `📊 记忆统计`,
        `───`,
        `📁 总文件数: ${totalFiles} (每日日志: ${dailyFiles})`,
        `💾 总大小: ${totalSizeKB}KB`,
        `🔍 FTS5 索引条目: ${ftsMemories}`,
      ];

      if (dbStats.datesSummary && Array.isArray(dbStats.datesSummary)) {
        lines.push(``, `📅 按日期分布:`);
        for (const d of (dbStats.datesSummary as Array<{ date: string; count: number }>)) {
          lines.push(`   ${d.date}: ${d.count} 条`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
