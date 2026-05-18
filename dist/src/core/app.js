import { createFeatureRegistry } from "../optional/registry.js";
import { embeddingFeature, llmFeature, cloudSyncFeature, verifyFeature, cleanerFeature, qualityFeature, retainFeature, graphFeature, } from "../optional/index.js";
import { registerMemoryTools } from "../tools/index.js";
import { registerCaptureHook } from "../hooks/auto-capture.js";
import { registerRecallHook } from "../hooks/auto-recall.js";
import { registerCommandNewHook } from "../hooks/command-new.js";
import { registerHeartbeatRecallHook } from "../hooks/heartbeat-recall.js";
import { readPluginVersion } from "../entry/version.js";
import { createAuditLog } from "../utils/audit-log.js";
import { runStartupTasks } from "./boot/startup-tasks.js";
import { stepConfigValidation, stepCoreInit, stepManifest, stepScopeManager, stepCrossSessionRecovery, stepMigration, stepCleanupScheduler, } from "./boot/steps.js";
import { runHealthcheck } from "../utils/healthcheck.js";
import { runInstallCheck, formatInstallCheck } from "../utils/install-check.js";
import { showBanner } from "../entry/banner.js";
export function bootstrapYaoyao(api, config) {
    const pluginVersion = readPluginVersion();
    const audit = createAuditLog(config.memoryDir || ".", api.logger, { bufferSize: 50, flushIntervalMs: 5000 });
    const cap = runInstallCheck();
    // ── 1. Platform detection & config ──
    api.logger.info?.(`[yaoyao-memory] ${formatInstallCheck(cap)}`);
    for (const w of cap.warnings)
        api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
    stepConfigValidation(api, config);
    stepConfigValidation(api, config);
    // ── 2. Core init ──
    const { store, storage, scopeManager } = stepCoreInit(api, config);
    // ── 3. Manifest & scope ──
    stepManifest(store.baseDir, pluginVersion);
    stepScopeManager(api, scopeManager);
    // ── 4. Feature Registry ──
    const registry = createFeatureRegistry();
    for (const f of [embeddingFeature, llmFeature, cloudSyncFeature, verifyFeature, cleanerFeature, qualityFeature, retainFeature, graphFeature]) {
        registry.register(f);
    }
    registry.initAll(api, config);
    const embedding = registry.service("embedding");
    const llmResult = registry.service("llm");
    if (llmResult?.client)
        api.logger.info?.(`[yaoyao-memory] LLM client: ${llmResult.client.config.model}`);
    // ── 5. Cross-session recovery & migration ──
    const agentId = api.agentId;
    stepCrossSessionRecovery(api, config, agentId);
    stepMigration(api, config);
    // ── 6. Deferred startup tasks ──
    setTimeout(() => runStartupTasks(api, config, storage, store), 100);
    // ── 7. Register tools & hooks ──
    const toolCount = registerMemoryTools(api, store, storage, storage, embedding, registry);
    const health = runHealthcheck(store.baseDir);
    showBanner(api.logger, { pluginVersion, toolCount, memoryDir: store.baseDir, cap: runInstallCheck(), health });
    let captureDrain;
    if (config.capture?.enabled !== false) {
        const capHandle = registerCaptureHook(api, store, storage, config, registry.isActive("verify"), scopeManager, llmResult?.client ?? null, audit, embedding);
        captureDrain = capHandle?.drain?.bind(capHandle);
    }
    if (config.recall?.enabled !== false) {
        registerRecallHook(api, storage, config, embedding, scopeManager, audit);
    }
    // ── Session boundary cleanup for /new and /reset ──
    if (config.hooks?.commandNew?.enabled !== false) {
        registerCommandNewHook(api);
    }
    // ── Heartbeat memory injection (OpenClaw 2026.5.12+) ──
    if (config.hooks?.heartbeat?.enabled !== false) {
        registerHeartbeatRecallHook(api, storage, embedding, {
            enabled: true,
            maxResults: config.hooks?.heartbeat?.maxResults ?? 3,
            minScore: config.hooks?.heartbeat?.minScore ?? 0.4,
            maxContextChars: config.hooks?.heartbeat?.maxContextChars ?? 800,
        });
    }
    // ── 8. Cleanup scheduler ──
    const { cleanupStop } = stepCleanupScheduler(api, config, storage);
    // ── 9. Shutdown ──
    api.on("gateway_stop", async () => {
        if (captureDrain) {
            try {
                await captureDrain();
                api.logger.info?.("[yaoyao-memory] Write queue drained");
            }
            catch { /* ignore */ }
        }
        storage.close();
        cleanupStop();
        api.logger.debug?.("[yaoyao-memory] Plugin stopped");
    });
    api.logger.debug?.("[yaoyao-memory] Plugin started");
    return { drain: captureDrain };
}
