/**
 * features/timeline/tool.ts — memory_timeline tool (modular).
 */

import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
import type { ToolRegistration } from "../../tools/common.js";
import type { DBBridge } from "../../utils/db-bridge.js";

export function createTimelineTool(db: DBBridge): ToolRegistration {
  return {
    name: "memory_timeline",
    label: "Memory Timeline",
    description: "Show a timeline view of memory activity. Visualizes when conversations happened over time with heat-map-like density bars.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default: 14)", default: 14 },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const days = clampNum(params.days, 14, 1, 90);
      const stats = db.getStats();
      const dates = stats.datesSummary || [];
      const now = new Date();
      const dateMap = new Map(dates.map(d => [d.date, d.count]));
      const lines = [`📅 记忆时间线 (最近 ${days} 天)`, `───`];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const count = dateMap.get(key) || 0;
        const barLen = Math.min(count, 10);
        const bar = count > 0 ? '█'.repeat(barLen) + (count > 10 ? `+${count - 10}` : '') : '·';
        lines.push(`  ${key.slice(5)} ${bar} ${count > 0 ? `${count}条` : ''}`);
      }

      const total = dates.reduce((sum, d) => sum + d.count, 0);
      lines.push(`───`, `📊 总计: ${total} 条记忆条目`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
