/**
 * features/trends/tool.ts — memory_trends tool (modular).
 */

import { clampNum } from "../../utils/clamp.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import path from "node:path";
import {
  extractTokens,
  countFrequencies,
  daysAgo,
  computeTrends,
  formatTrendsReport,
} from "../../core/trends/trends.ts";

export function createTrendsTool(store: MemoryStore): ToolRegistration {
  return {
    name: "memory_trends",
    label: "Memory Trends",
    description:
      "分析指定周期内记忆中的高频话题与趋势。通过日常日志词频统计，识别上升/下降话题。无需 LLM，仅基于词频。",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["7d", "30d", "90d", "all"],
          description: "分析周期：7d（近7天）、30d（近30天）、90d（近90天）、all（全部）",
        },
        topN: {
          type: "number",
          description: "返回 Top N 话题",
          default: 10,
        },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const period = String(params.period || "30d");
      const topN = clampNum(params.topN, 10, 1, 50);

      let cutoffDate: string | null = null;
      if (period !== "all") {
        const days = parseInt(period, 10);
        cutoffDate = daysAgo(days);
      }

      const allFiles = store.listFiles().filter(f => f.type === "daily" && f.date != null);

      let filteredFiles = allFiles;
      if (cutoffDate) {
        filteredFiles = allFiles.filter(f => f.date! >= cutoffDate);
      }

      if (filteredFiles.length === 0) {
        return {
          content: [{ type: "text", text: `在指定周期内没有找到记忆文件。` }],
        };
      }

      filteredFiles.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      const allTokens: string[] = [];
      const earlyTokens: string[] = [];
      const lateTokens: string[] = [];

      const midPoint = Math.floor(filteredFiles.length / 2);

      for (let i = 0; i < filteredFiles.length; i++) {
        const f = filteredFiles[i];
        const filePath = f.path || path.join(store.baseDir, f.filename);
        const content = store.readFile(filePath);
        if (!content) continue;

        const tokens = extractTokens(content);
        allTokens.push(...tokens);

        if (i < midPoint) {
          earlyTokens.push(...tokens);
        } else {
          lateTokens.push(...tokens);
        }
      }

      if (allTokens.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `在 ${period === "all" ? "全部" : `近 ${period}`} 周期内没有提取到足够的关键词。`,
            },
          ],
        };
      }

      const allFreq = countFrequencies(allTokens);
      const earlyFreq = countFrequencies(earlyTokens);
      const lateFreq = countFrequencies(lateTokens);

      const trends = computeTrends(allFreq, earlyFreq, lateFreq, topN);
      const report = formatTrendsReport(trends, period, filteredFiles.length, allTokens.length, topN);

      return { content: [{ type: "text", text: report }] };
    }),
  };
}
