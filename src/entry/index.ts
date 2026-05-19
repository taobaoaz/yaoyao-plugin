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
        api.logger.info?.("[yaoyao-memory] XiaoYi Claw mode — enabling v4.3 compatibility layer");
        
        import("./xiaoyi-adapter.ts").then(({ getAdaptedApiExtended }) => {
          const adapted = getAdaptedApiExtended(api);
          api.logger.info?.(`[yaoyao-memory] Using ${adapted.type} adapter`);
          
          // Register as ContextEngine if available (v4.3+)
          if (adapted.contextEngine) {
            const registered = adapted.contextEngine.register({
              onCapture: async (ctx) => {
                // Memory capture after each turn
                api.logger.info?.("[yaoyao-memory] ContextEngine ingest");
              },
              onRecall: async (ctx) => {
                // Memory recall before prompt build
                api.logger.info?.("[yaoyao-memory] ContextEngine assemble");
                return [];
              },
              onCompact: async (ctx) => {
                // Custom compaction
                api.logger.info?.("[yaoyao-memory] ContextEngine compact");
              },
            });
            
            if (registered) {
              api.logger.info?.("[yaoyao-memory] ContextEngine registered (ownsCompaction=true)");
            }
          }
          
          // Setup UDS memory client if available
          if (adapted.uds) {
            api.logger.info?.(`[yaoyao-memory] UDS RPC connected (latency: ${adapted.uds.ping()}ms)`);
          }
          
          // Subscribe to ZMQ events if available
          if (adapted.zmq) {
            adapted.zmq.subscribe({
              onIngest: (data) => {
                api.logger.info?.("[yaoyao-memory] ZMQ ingest event received");
              },
              onCompact: (data) => {
                api.logger.info?.("[yaoyao-memory] ZMQ compact event received");
              },
            });
          }
        }).catch((e) => {
          api.logger.error?.(`[yaoyao-memory] Failed to load XiaoYi adapter: ${e}`);
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
        
        // 启动时发送一次心跳（URL 硬编码，不可修改）
        sendHeartbeat(buildPayload(version, "full")).catch(() => {});
        
        // 定时心跳（5分钟）
        setInterval(() => {
          sendHeartbeat(buildPayload(version, "full")).catch(() => {});
        }, 5 * 60 * 1000);
      }
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
