/**
 * features/telemetry/tool.ts — Telemetry query tool.
 */

import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import { queryInstallCount } from "../../utils/telemetry.ts";

interface TelemetryArgs {
  action: "count" | "status";
}

export function createTelemetryTool(): ToolRegistration {
  return {
    id: "memory_telemetry",
    name: "memory_telemetry",
    label: "安装统计",
    description: "查询 yaoyao-memory 插件的匿名安装统计（隐私优先，无 PII）",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["count", "status"],
          description: "count=查询活跃安装数, status=查询遥测功能状态",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action || "count") as TelemetryArgs["action"];
      if (action === "count") {
        const result = await queryInstallCount();
        if (result.error) {
          return { content: [{ type: "text", text: `查询失败: ${result.error}` }] };
        }
        return {
          content: [{
            type: "text",
            text: `当前有 ${result.count} 个活跃安装使用 yaoyao-memory\n\n统计基于匿名心跳去重，不包含任何用户内容或个人信息。`,
          }],
        };
      }
      // status
      return {
        content: [{
          type: "text",
          text: `遥测状态:\n- 启用: 是\n- 隐私级别: 严格\n- 收集数据: anonymous_install_id, version, timestamp, node_version\n- 不收集: user_content, messages, files, personal_info, ip_address\n- 关闭方式: 设置环境变量 YAOYAO_TELEMETRY=0`,
        }],
      };
    }),
  };
}
