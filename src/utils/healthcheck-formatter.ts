/**
 * utils/healthcheck-formatter.ts — Health result formatting.
 */
import type { HealthResult } from "./healthcheck.ts";

export function formatHealthcheck(result: HealthResult): string {
  const lines = [
    `## 🏥 环境诊断报告`,
    ``,
    `**总体状态**: ${result.ok ? "✅ 通过" : "❌ 未通过"}`,
    ``,
    `| 检查项 | 状态 | 说明 |`,
    `|--------|------|------|`,
  ];
  for (const c of result.checks) {
    const icon = c.status === "pass" ? "🟢" : c.status === "warn" ? "🟡" : "🔴";
    lines.push(`| ${c.name} | ${icon} ${c.status.toUpperCase()} | ${c.message} |`);
    if (c.detail) {
      lines.push(`| | | *${c.detail}* |`);
    }
  }
  lines.push(``, `**${result.summary}**`, ``);
  return lines.join("\n");
}
