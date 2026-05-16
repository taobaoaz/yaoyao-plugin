/**
 * features/healthcheck/tool.ts — memory_healthcheck tool (modular).
 */

import { withErrorHandling } from "../../tools/common.js";
import type { ToolRegistration } from "../../tools/common.js";
import { runHealthcheck, formatHealthcheck } from "../../utils/healthcheck.js";

export function createHealthcheckTool(): ToolRegistration {
  return {
    name: "memory_healthcheck",
    label: "环境自检",
    description: "🏥 运行环境诊断检查，验证 Node.js 版本、SQLite 支持、磁盘空间、WAL 兼容性、UTF-8 编码等。用于排查启动异常或运行故障。",
    parameters: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["simple", "full"],
          default: "simple",
          description: "simple=仅返回总体状态和失败项；full=返回完整检查表格",
        },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const detail = String(params.detail || "simple");
      const rawResult = runHealthcheck();
      // Defensive clone: prevent accidental mutation of internal result structure
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(JSON.stringify(rawResult));
      } catch {
        result = { ok: false, checks: [] };
      }

      if (detail === "full") {
        return { content: [{ type: "text", text: formatHealthcheck(result) }] };
      }

      const fails = result.checks.filter(c => c.status === "fail");
      const warns = result.checks.filter(c => c.status === "warn");
      const lines = [
        `## 🏥 环境自检（简要）`,
        ``,
        `**总体状态**: ${result.ok ? "✅ 通过" : "❌ 未通过"}`,
        ``,
      ];
      if (fails.length > 0) {
        lines.push(`**❌ 未通过 (${fails.length} 项)**:`, ...fails.map(c => `- ${c.name}: ${c.message}${c.detail ? ` (${c.detail})` : ""}`), "");
      }
      if (warns.length > 0) {
        lines.push(`**⚠️ 警告 (${warns.length} 项)**:`, ...warns.map(c => `- ${c.name}: ${c.message}`), "");
      }
      if (fails.length === 0 && warns.length === 0) {
        lines.push("**✅ 全部通过，无警告**", "");
      }
      lines.push(`如需完整报告，请调用 detail: "full"`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
