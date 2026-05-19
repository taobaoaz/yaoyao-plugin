/**
 * Plugin entry — delegates all bootstrap to core/app.ts.
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { bootstrapYaoyao } from "../core/app.ts";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.ts";
import { createTelemetryTool } from "../features/telemetry/tool.ts";

export default definePluginEntry({
  id: "yaoyao-memory",
  name: "Yaoyao Memory",
  description: "自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份",
  register(api: OpenClawPluginApi) {
    try {
      bootstrapYaoyao(api, (api.pluginConfig || {}) as unknown as YaoyaoMemoryConfig);

      // === Telemetry ===
      const telemetryConfig = {
        enabled: process.env.YAOYAO_TELEMETRY !== "0",
        url: process.env.YAOYAO_TELEMETRY_URL,
      };

      api.registerTool(createTelemetryTool(telemetryConfig));

      if (telemetryConfig.enabled) {
        const version = (api.pluginConfig?.version as string) || "unknown";
        const payload = buildPayload(version, "full");
        const url = telemetryConfig.url || "https://yaoyao.dev/api/heartbeat";
        sendHeartbeat(payload, url).catch(() => {
          // Silently fail — telemetry must never block registration
        });
      }
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
