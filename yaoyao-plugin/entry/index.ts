/**
 * Plugin entry — Universal adapter for OpenClaw / XiaoYi Claw.
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { bootstrapYaoyao } from "../core/app.ts";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.ts";
import { createTelemetryTool } from "../features/telemetry/tool.ts";
import { detectEnvironment, isXiaoYiClaw } from "../utils/environment-detector.ts";

export default definePluginEntry({
  id: "yaoyao-memory",
  name: "Yaoyao Memory",
  description: "自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份",
  register(api: OpenClawPluginApi) {
    try {
      // === Environment Detection ===
      const env = detectEnvironment();
      const isXiaoYi = isXiaoYiClaw();
      
      api.logger.info?.(`[yaoyao-memory] Detected environment: ${env}`);

      // === Bootstrap Core ===
      bootstrapYaoyao(api, (api.pluginConfig || {}) as unknown as YaoyaoMemoryConfig);

      // === XiaoYi Claw Adaptations ===
      if (isXiaoYi) {
        // 小艺 Claw 特定适配
        api.logger.info?.("[yaoyao-memory] XiaoYi Claw mode — enabling compatibility layer");
        
        // 小艺 Claw 可能有不同的 hook 系统，需要适配
        // 这里可以添加特定适配代码
      }

      // === Telemetry ===
      const telemetryConfig = {
        enabled: process.env.YAOYAO_TELEMETRY !== "0",
        url: process.env.YAOYAO_TELEMETRY_URL,
      };

      api.registerTool(createTelemetryTool(telemetryConfig));

      if (telemetryConfig.enabled) {
        const version = (api.pluginConfig?.version as string) || "unknown";
        const url = telemetryConfig.url || "https://yaoyao.dev/api/heartbeat";
        
        // 启动时发送一次心跳
        sendHeartbeat(buildPayload(version, "full"), url).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
        });
        
        // 定时心跳（5分钟，可配置）
        const heartbeatInterval = parseInt(process.env.YAOYAO_HEARTBEAT_INTERVAL || "", 10) || 5 * 60 * 1000;
        const heartbeatTimer = setInterval(() => {
          sendHeartbeat(buildPayload(version, "full"), url).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
          });
        }, heartbeatInterval);
        
        // 注册清理函数（当插件卸载时清理定时器）
        api.onUnload?.(() => {
          clearInterval(heartbeatTimer);
          api.logger.info?.("[yaoyao-memory] Heartbeat timer cleared");
        });
      }
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
