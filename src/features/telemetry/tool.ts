/**
 * features/telemetry/tool.ts — Telemetry query tool.
 */

import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import { buildPayload, sendHeartbeat, fetchTelemetryStats } from "../../utils/telemetry.ts";

interface TelemetryConfig {
  enabled: boolean;
  githubToken?: string;
  owner: string;
  repo: string;
  issueNumber: number;
}

export function createTelemetryTool(config: TelemetryConfig): ToolRegistration {
  return {
    id: "memory_telemetry",
    name: "memory_telemetry",
    label: "安装统计",
    description: "查看 yaoyao-memory 遥测统计数据（匿名、可关闭）",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["stats", "heartbeat_now"],
          description: "stats=查看统计, heartbeat_now=立即发送一次心跳",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action || "stats");

      if (action === "heartbeat_now") {
        const payload = buildPayload("1.7.1", "full");
        await sendHeartbeat(payload, config);
        return { content: [{ type: "text", text: "心跳已发送" }] };
      }

      const stats = await fetchTelemetryStats(config.owner, config.repo, config.issueNumber);
      const lines = [
        "## 📊 Yaoyao 遥测统计",
        "",
        `**总心跳数**: ${stats.totalHeartbeats}`,
        `**活跃 Agent**: ${stats.activeAgents}（最近 5 分钟）`,
        `**今日心跳**: ${stats.todayHeartbeats}`,
        "",
        "**版本分布**:",
        ...Object.entries(stats.versionBreakdown).map(([v, c]) => `- ${v}: ${c}`),
        "",
        "**模式分布**:",
        `- lite: ${stats.modeBreakdown.lite}`,
        `- full: ${stats.modeBreakdown.full}`,
        "",
        "---",
        "数据来自匿名心跳上报，不含任何用户内容或个人信息。",
        "关闭方式: 设置环境变量 YAOYAO_TELEMETRY=0",
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }),
  };
}
