/**
 * Plugin entry — Universal adapter for OpenClaw / XiaoYi Claw.
 *
 * v1.7.2: System architecture detection
 *   - Reads OpenClaw global config (~/.openclaw/openclaw.json)
 *   - Detects if memory/contextEngine slots are owned by claw-core
 *   - Automatically selects strategy: full | l0-only | supplement | disabled
 *   - Coexistence with runtime UDS monitoring
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { bootstrapYaoyao } from "../core/app.js";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.js";
import { createTelemetryTool } from "../features/telemetry/tool.js";
import { detectEnvironment, isXiaoYiClaw } from "../utils/environment-detector.js";
import { detectSystemArchitecture, getRecommendedStrategy } from "../utils/system-config-reader.js";
import { detectCoexistence, startCoexistenceMonitor, onCoexistChange, setCoexistMode, getCoexistMode, getCoexistState } from "../utils/coexistence.js";
export default definePluginEntry({
    id: "yaoyao-memory",
    name: "Yaoyao Memory",
    version: "1.7.2",
    description: "自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份",
    register(api) {
        try {
            // === Environment Detection ===
            const env = detectEnvironment();
            const isXiaoYi = isXiaoYiClaw();
            api.logger.info?.(`[yaoyao-memory] Detected environment: ${env}`);
            // === System Architecture Detection ===
            const sysArch = detectSystemArchitecture();
            const strategy = getRecommendedStrategy(sysArch);
            api.logger.info?.(`[yaoyao-memory] System: ${sysArch.isXiaoYiClaw ? "XiaoYi Claw" : "Standard OpenClaw"} (ver=${sysArch.openClawVersion})`);
            api.logger.info?.(`[yaoyao-memory] Memory slot: ${sysArch.memorySlotOwner} | ContextEngine: ${sysArch.contextEngineSlotOwner}`);
            api.logger.info?.(`[yaoyao-memory] Strategy: capture=${strategy.captureMode}, recall=${strategy.recallMode}`);
            // === Coexistence Detection (runtime UDS + config-based) ===
            const coexist = detectCoexistence();
            // If system config says XiaoYi Claw, force coexist mode regardless of UDS
            if (sysArch.isXiaoYiClaw && coexist.mode === "standalone") {
                setCoexistMode("coexist");
                api.logger.info?.("[yaoyao-memory] Config-forced coexistence (claw-core in system architecture)");
            }
            const finalMode = getCoexistMode();
            const finalState = getCoexistState();
            if (finalMode === "coexist") {
                api.logger.info?.(`[yaoyao-memory] Coexist mode — L1/L2 skipped, heavy lifting delegated to claw-core${finalState.gatewayVersion ? ` (Gateway ${finalState.gatewayVersion})` : ""}${finalState.gatewayAlive ? " [mmap heartbeat OK]" : " [UDS socket only]"}`);
            }
            else {
                api.logger.info?.("[yaoyao-memory] Standalone mode — all layers active");
            }
            // Start periodic monitor (v4.6: 10s interval for rapid detection — Gateway heartbeat is 5s)
            const stopMonitor = startCoexistenceMonitor(10000);
            api.logger.debug?.("[yaoyao-memory] Coexistence monitor started (10s interval, v4.6 mmap-aware)");
            // React to transitions
            onCoexistChange((prev, next) => {
                if (prev.mode !== "coexist" && next.mode === "coexist") {
                    api.logger.info?.(`[yaoyao-memory] claw-core appeared at runtime — switching to coexist mode${next.gatewayVersion ? ` (Gateway ${next.gatewayVersion})` : ""}`);
                }
                else if (prev.mode === "coexist" && next.mode !== "coexist") {
                    api.logger.info?.("[yaoyao-memory] claw-core disappeared at runtime — switching to standalone mode");
                }
            });
            // === XiaoYi Claw Adaptations ===
            if (isXiaoYi) {
                api.logger.info?.("[yaoyao-memory] XiaoYi Claw mode — enabling compatibility layer");
            }
            // === Bootstrap Core ===
            bootstrapYaoyao(api, (api.pluginConfig || {}));
            // === Telemetry ===
            const telemetryConfig = {
                enabled: process.env.YAOYAO_TELEMETRY !== "0",
                url: process.env.YAOYAO_TELEMETRY_URL,
            };
            api.registerTool(createTelemetryTool(telemetryConfig));
            if (telemetryConfig.enabled) {
                const version = api.pluginConfig?.version || "unknown";
                const url = telemetryConfig.url || "https://yaoyao.dev/api/heartbeat";
                // 启动时发送一次心跳
                sendHeartbeat(buildPayload(version, "full"), url).catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
                });
                // 定时心跳（5分钟，可配置）
                const heartbeatInterval = parseInt(process.env.YAOYAO_HEARTBEAT_INTERVAL || "", 10) || 5 * 60 * 1000;
                const heartbeatTimer = setInterval(() => {
                    sendHeartbeat(buildPayload(version, "full"), url).catch((err) => {
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
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
