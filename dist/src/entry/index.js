/**
 * Plugin entry — OpenClaw plugin adapter.
 *
 * v1.8.0: XiaoYi environment adaptation restored — pure OpenClaw plugin.
 *   - Removed: xiaoyi-adapter, XiaoYi-specific detection
 *   - Kept: environment detection, coexistence monitor (generic claw-core),
 *           telemetry heartbeat
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { bootstrapYaoyao } from "../core/app.js";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.js";
import { createTelemetryTool } from "../features/telemetry/tool.js";
import { detectEnvironment } from "../utils/environment-detector.js";
import { detectCoexistence, startCoexistenceMonitor, onCoexistChange, getCoexistMode, getCoexistState, } from "../utils/coexistence.js";
export default definePluginEntry({
    id: 'yaoyao-memory',
    name: 'Yaoyao Memory',
    version: '1.8.2',
    description: '自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份',
    register(api) {
        try {
            // === Environment Detection ===
            const env = detectEnvironment();
            api.logger.info?.(`[yaoyao-memory] Detected environment: ${env}`);
            // === Coexistence Detection (config + filesystem based) ===
            const coexist = detectCoexistence();
            const finalMode = getCoexistMode();
            const finalState = getCoexistState();
            if (finalMode === 'coexist') {
                api.logger.info?.(`[yaoyao-memory] Coexist mode — L1/L2 skipped, heavy lifting delegated to claw-core${finalState.gatewayVersion ? ` (Gateway ${finalState.gatewayVersion})` : ''}${finalState.gatewayAlive ? ' [alive]' : ' [socket only]'}`);
            }
            else if (finalMode === 'standalone') {
                api.logger.info?.('[yaoyao-memory] Standalone mode — all layers active');
            }
            // Start periodic monitor (10s interval)
            const stopMonitor = startCoexistenceMonitor(10000);
            api.logger.debug?.('[yaoyao-memory] Coexistence monitor started (10s interval)');
            // React to transitions
            onCoexistChange((prev, next) => {
                if (prev.mode !== 'coexist' && next.mode === 'coexist') {
                    api.logger.info?.(`[yaoyao-memory] claw-core appeared at runtime — switching to coexist mode${next.gatewayVersion ? ` (Gateway ${next.gatewayVersion})` : ''}`);
                }
                else if (prev.mode === 'coexist' && next.mode !== 'coexist') {
                    api.logger.info?.('[yaoyao-memory] claw-core disappeared at runtime — switching to standalone mode');
                }
            });
            // === Bootstrap Core ===
            bootstrapYaoyao(api, (api.pluginConfig || {}));
            // === Telemetry ===
            const telemetryConfig = {
                enabled: process.env.YAOYAO_TELEMETRY !== '0',
                url: process.env.YAOYAO_TELEMETRY_URL,
            };
            api.registerTool?.(createTelemetryTool(telemetryConfig));
            if (telemetryConfig.enabled) {
                const version = api.pluginConfig?.version || 'unknown';
                const url = telemetryConfig.url || 'https://yaoyao.dev/api/heartbeat';
                // 启动时发送一次心跳
                sendHeartbeat(buildPayload(version, 'full'), url).catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
                });
                // 定时心跳（5分钟，可配置）
                const heartbeatInterval = parseInt(process.env.YAOYAO_HEARTBEAT_INTERVAL || '', 10) || 5 * 60 * 1000;
                const heartbeatTimer = setInterval(() => {
                    sendHeartbeat(buildPayload(version, 'full'), url).catch((err) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
                    });
                }, heartbeatInterval);
                // 注册清理函数（当插件卸载时清理定时器）
                const unloadFn = api.onUnload;
                unloadFn?.(() => {
                    clearInterval(heartbeatTimer);
                    stopMonitor();
                    api.logger.info?.('[yaoyao-memory] Heartbeat timer + coexistence monitor cleared');
                });
            }
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
