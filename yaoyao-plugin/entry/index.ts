/**
 * Plugin entry — Universal adapter for OpenClaw / XiaoYi Claw.
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { bootstrapYaoyao } from "../core/app.ts";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.ts";
import { createTelemetryTool } from "../features/telemetry/tool.ts";
import { detectEnvironment, isXiaoYiClaw } from "../utils/environment-detector.ts";
import { detectCoexistence, setCoexistMode } from "../utils/coexistence.ts";

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

      // === Coexistence Detection (xiaoyiclaw claw-core) ===
      const coexist = detectCoexistence();
      setCoexistMode(coexist.mode);
      if (coexist.mode === "coexist") {
        api.logger.info?.(`[yaoyao-memory] claw-core detected (UDS=${coexist.udsPath}) — entering coexistence mode`);
        api.logger.info?.("[yaoyao-memory] L1/L2 indexing skipped; heavy lifting delegated to claw-core");
      } else {
        api.logger.info?.("[yaoyao-memory] Standalone mode — all layers active");
      }

      // === XiaoYi Claw Adaptations ===
      if (isXiaoYi) {
        api.logger.info?.("[yaoyao-memory] XiaoYi Claw mode — enabling compatibility layer");
      }

      // === Bootstrap Core ===
      bootstrapYaoyao(api, (api.pluginConfig || {}) as unknown as YaoyaoMemoryConfig);

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
