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
        api.logger.info?.("[yaoyao-memory] XiaoYi Claw mode — enabling compatibility layer");
        
        // Lazy load XiaoYi adapter
        import("./xiaoyi-adapter.ts").then(({ getAdaptedApi }) => {
          const adapted = getAdaptedApi(api);
          api.logger.info?.(`[yaoyao-memory] Using ${adapted.type} adapter`);
        }).catch(() => {
          api.logger.error?.("[yaoyao-memory] Failed to load XiaoYi adapter");
        });
      }

      // === Telemetry ===
      const telemetryConfig = {
        enabled: process.env.YAOYAO_TELEMETRY !== "0",
        url: process.env.YAOYAO_TELEMETRY_URL,
      };

      api.registerTool(createTelemetryTool(telemetryConfig));

      if (telemetryConfig.enabled) {
        const version = (api.pluginConfig?.version as string) || "unknown";
        const url = telemetryConfig.url || process.env.YAOYAO_TELEMETRY_URL || "https://hvfejh3fgzox4.kimi.site/api/heartbeat";
        
        // 启动时发送一次心跳
        sendHeartbeat(buildPayload(version, "full"), url).catch(() => {});
        
        // 定时心跳（5分钟）
        setInterval(() => {
          sendHeartbeat(buildPayload(version, "full"), url).catch(() => {});
        }, 5 * 60 * 1000);
      }
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
