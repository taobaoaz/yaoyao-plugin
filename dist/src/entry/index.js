/**
 * Plugin entry — OpenClaw plugin adapter.
 *
 * v1.7.9: XiaoYi Claw code removed — pure OpenClaw plugin.
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { bootstrapYaoyao } from "../core/app.js";
import { buildPayload, sendHeartbeat } from "../utils/telemetry.js";
import { detectEnvironment } from "../utils/environment-detector.js";
import { createTelemetryTool } from "../features/telemetry/tool.js";
import { detectCoexistence, startCoexistenceMonitor, onCoexistChange, setCoexistMode, getCoexistMode, getCoexistState } from "../utils/coexistence.js";

export default definePluginEntry({
    id: 'yaoyao-memory',
    name: 'Yaoyao Memory',
    version: '1.7.9',
    description: '自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份',
    register(api) {
        try {
            // === Environment Detection ===
            const env = detectEnvironment();
            api.logger.info?.(`[yaoyao-memory] Detected environment: ${env}`);

            // === Coexistence Detection ===
            const coexist = detectCoexistence();
            const finalMode = getCoexistMode();
            const finalState = getCoexistState();
            if (finalMode === 'coexist') {
                api.logger.info?.(`[yaoyao-memory] Coexist mode — L1/L2 skipped, heavy lifting delegated to claw-core${finalState.gatewayVersion ? ` (Gateway ${finalState.gatewayVersion})` : ''}${finalState.gatewayAlive ? ' [alive]' : ' [socket only]'}`);
            } else if (finalMode === 'standalone') {
                api.logger.info?.('[yaoyao-memory] Standalone mode — all layers active');
            }

            const stopMonitor = startCoexistenceMonitor(10000);
            api.logger.debug?.('[yaoyao-memory] Coexistence monitor started (10s interval)');

            onCoexistChange((prev, next) => {
                if (prev.mode !== 'coexist' && next.mode === 'coexist') {
                    api.logger.info?.(`[yaoyao-memory] claw-core appeared at runtime — switching to coexist mode${next.gatewayVersion ? ` (Gateway ${next.gatewayVersion})` : ''}`);
                } else if (prev.mode === 'coexist' && next.mode !== 'coexist') {
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
                const version = (api.pluginConfig?.version) || 'unknown';
                const url = telemetryConfig.url || 'https://yaoyao.dev/api/heartbeat';

                sendHeartbeat(buildPayload(version, 'full'), url).catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
                });

                const heartbeatInterval = parseInt(process.env.YAOYAO_HEARTBEAT_INTERVAL || '', 10) || 5 * 60 * 1000;
                const heartbeatTimer = setInterval(() => {
                    sendHeartbeat(buildPayload(version, 'full'), url).catch((err) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        api.logger.debug?.(`[yaoyao-memory:telemetry] Heartbeat failed: ${msg}`);
                    });
                }, heartbeatInterval);

                const unloadFn = api.onUnload;
                if (unloadFn) {
                    unloadFn(() => {
                        clearInterval(heartbeatTimer);
                        stopMonitor();
                        api.logger.info?.('[yaoyao-memory] Heartbeat timer + coexistence monitor cleared');
                    });
                }
            }
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});