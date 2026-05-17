/**
 * entry/index.ts — Yaoyao Memory plugin entry point (modular, <200 lines).
 *
 * Three steps only:
 *   1. Detect platform capabilities
 *   2. Initialize core (store, db) + optional features via registry
 *   3. Register features (tools, hooks, banner)
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { runInstallCheck, formatInstallCheck } from "../utils/install-check.js";
import { createMemoryStore } from "../utils/memory-store.js";
import { createDB } from "../utils/db-bridge.js";
import { registerMemoryTools } from "../tools/index.js";
import { registerCaptureHook } from "../hooks/auto-capture.js";
import { registerRecallHook } from "../hooks/auto-recall.js";
import { createMemoryCleaner, getNextCleanTimeMs } from "../utils/memory-cleaner.js";
import { runHealthcheck, formatHealthcheck } from "../utils/healthcheck.js";
import { showBanner } from "./banner.js";
import { detectLegacy, cleanupOldSkills } from "./migration.js";
import { readPluginVersion } from "./version.js";
import { initManifest } from "../utils/manifest.js";
import { runTextCompaction } from "../utils/memory-compactor.js";
import { SimpleScopeManager } from "../utils/scope-manager.js";
import { readCrossSessionMemories, resolveSessionSearchDirs } from "../utils/session-recovery.js";
import { evaluateAllTiers, DEFAULT_TIER_CONFIG } from "../utils/tier-manager.js";
import { validateConfig, logValidationResults } from "../utils/config-validator.js";
import { createAuditLog } from "../utils/audit-log.js";
// ── Optional feature registry ──
import { createFeatureRegistry, embeddingFeature, llmFeature, cloudSyncFeature, verifyFeature, cleanerFeature, qualityFeature, retainFeature, graphFeature, } from "../optional/index.js";
export default definePluginEntry({
    id: "yaoyao-memory",
    name: "Yaoyao Memory",
    description: "Yaoyao Memory — 自适应记忆引擎，支持所有 Node.js 与 OpenClaw 版本。FTS5 + 向量搜索 + 时间线 + 云备份。",
    register(api) {
        // ── 1. Platform detection ──
        const cap = runInstallCheck();
        api.logger.info?.(`[yaoyao-memory] 环境能力报告:\n${formatInstallCheck(cap)}`);
        for (const w of cap.warnings)
            api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
        try {
            // ── 2. Core initialization ──
            const config = (api.pluginConfig || {});
            const store = createMemoryStore(config, api.logger);
            const db = createDB(config, api.logger);
            // ── 1.5. Config validation ──
            const validationResults = validateConfig(config);
            const hasErrors = validationResults.some(r => r.level === "error");
            logValidationResults(validationResults, api.logger);
            if (hasErrors) {
                api.logger.warn?.("[yaoyao-memory] Configuration has errors — some features may be disabled");
            }
            // ── 1.6. Audit log ──
            const audit = createAuditLog(store.baseDir, api.logger, {
                bufferSize: 50,
                flushIntervalMs: 5000,
            });
            const pluginVersion = readPluginVersion();
            // Tencent-style manifest: record store binding and version history
            const manifest = initManifest(store.baseDir, pluginVersion);
            api.logger.debug?.(`[yaoyao-memory:manifest] Initialized v${manifest.pluginVersion}, first init: ${manifest.firstInitAt}`);
            // ── 3. Optional features registry ──
            const registry = createFeatureRegistry();
            registry.register(embeddingFeature);
            registry.register(llmFeature);
            registry.register(cloudSyncFeature);
            registry.register(verifyFeature);
            registry.register(cleanerFeature);
            registry.register(qualityFeature);
            registry.register(retainFeature);
            registry.register(graphFeature);
            registry.initAll(api, config);
            const embedding = registry.service("embedding");
            const llmResult = registry.service("llm");
            const verifyActive = registry.isActive("verify");
            // Log LLM state
            if (llmResult?.client) {
                const sourceLabel = llmResult.source === "explicit" ? "explicit llm config" : "auto-detected from embedding config";
                api.logger.info?.(`[yaoyao-memory] LLM client initialized (${sourceLabel}): ${llmResult.client.config.model}`);
                if (llmResult.source === "embedding-auto") {
                    api.logger.info?.(`[yaoyao-memory] LLM pipeline is now active using your embedding API key.`);
                    api.logger.info?.(`[yaoyao-memory] To disable, set llm: { enabled: false } in plugin config.`);
                }
            }
            else {
                api.logger.info?.("[yaoyao-memory] No LLM available — L1/L2/L3 extraction pipeline disabled (configure embedding or llm API to enable)");
            }
            // ── 5. Scope Manager (Brain-style multi-agent isolation) ──
            const scopeManager = new SimpleScopeManager();
            const agentId = api.agentId;
            if (agentId) {
                scopeManager.grantAccess(agentId, ["global", `agent:${agentId}`]);
            }
            // ── 5.5 Session Recovery (Brain-style cross-session context) ──
            try {
                const searchDirs = resolveSessionSearchDirs({
                    context: (api.context || {}),
                    cfg: api.pluginConfig || {},
                    workspaceDir: api.baseDir || ".",
                    currentSessionFile: api.sessionFile,
                    sourceAgentId: agentId,
                });
                const crossSessionMemories = readCrossSessionMemories(searchDirs, {
                    maxMemories: config.sessionRecovery?.maxMemories ?? 10,
                    maxAgeMs: config.sessionRecovery?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
                });
                if (crossSessionMemories.length > 0) {
                    api.logger.info?.(`[yaoyao-memory:recovery] Loaded ${crossSessionMemories.length} cross-session memories from ${searchDirs.length} dirs`);
                    // Store cross-session context as ephemeral system context
                    api._crossSessionContext = crossSessionMemories;
                }
            }
            catch (recoveryErr) {
                api.logger.debug?.(`[yaoyao-memory:recovery] Cross-session recovery skipped: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`);
            }
            // ── 6. Migration & cleanup ──
            const migration = detectLegacy(config, api.baseDir || ".");
            if (migration.hasLegacy) {
                for (const line of migration.bannerLines) {
                    api.logger.warn?.(`[yaoyao-memory:migration] ${line}`);
                }
            }
            cleanupOldSkills(api.logger);
            // ── 7. Database init ──
            const initOk = db.init();
            if (!initOk) {
                api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
            }
            // ── 8. Memory compactor (Brain-style progressive summarization) ──
            try {
                const allEntries = db.getAllMeta ? db.getAllMeta() : [];
                const compactorConfig = {
                    enabled: config.compaction?.enabled ?? true,
                    minAgeDays: config.compaction?.minAgeDays ?? 7,
                    similarityThreshold: config.compaction?.similarityThreshold ?? 0.5,
                    minClusterSize: config.compaction?.minClusterSize ?? 2,
                    maxEntriesToScan: config.compaction?.maxEntriesToScan ?? 200,
                    dryRun: config.compaction?.dryRun ?? false,
                };
                const compactionResult = runTextCompaction(allEntries.map(e => ({
                    id: String(e.id),
                    text: e.filename,
                    category: "general",
                    importance: 0.5,
                    timestamp: Date.now(),
                    scope: "global",
                })), compactorConfig);
                if (compactionResult.clustersFound > 0) {
                    api.logger.info?.(`[yaoyao-memory:compactor] Scanned ${compactionResult.scanned} entries, found ${compactionResult.clustersFound} clusters`);
                    if (!compactionResult.dryRun) {
                        api.logger.info?.(`[yaoyao-memory:compactor] Would merge ${compactionResult.entriesDeleted} → ${compactionResult.entriesCreated} entries`);
                    }
                }
            }
            catch (compactorErr) {
                api.logger.debug?.(`[yaoyao-memory:compactor] Startup compaction skipped: ${compactorErr instanceof Error ? compactorErr.message : String(compactorErr)}`);
            }
            // ── 8.5 Tier Manager (Brain-style memory promotion/demotion) ──
            try {
                const rawDb = db.getRawDb ? db.getRawDb() : null;
                if (rawDb) {
                    const rows = rawDb.prepare("SELECT id, metadata, access_count, created_at FROM memory_meta WHERE metadata IS NOT NULL").all();
                    const tierable = rows.map(r => {
                        let tier = "working";
                        let importance = 0.5;
                        let accessCount = r.access_count ?? 0;
                        let createdAt = r.created_at ?? Date.now();
                        let decayScore = 0.5;
                        try {
                            const meta = JSON.parse(r.metadata || "{}");
                            tier = meta.tier || "working";
                            importance = typeof meta.importance === "number" ? meta.importance : 0.5;
                            accessCount = typeof meta.accessCount === "number" ? meta.accessCount : (r.access_count ?? 0);
                            decayScore = typeof meta.decayScore === "number" ? meta.decayScore : 0.5;
                        }
                        catch { /* ignore */ }
                        return { id: String(r.id), tier, importance, accessCount, createdAt, decayScore };
                    });
                    const transitions = evaluateAllTiers(tierable, DEFAULT_TIER_CONFIG);
                    if (transitions.length > 0) {
                        api.logger.info?.(`[yaoyao-memory:tier] Evaluated ${tierable.length} memories, ${transitions.length} tier transitions pending`);
                        for (const t of transitions.slice(0, 5)) {
                            api.logger.debug?.(`[yaoyao-memory:tier] ${t.memoryId}: ${t.fromTier} → ${t.toTier} (${t.reason})`);
                        }
                    }
                }
            }
            catch (tierErr) {
                api.logger.debug?.(`[yaoyao-memory:tier] Startup tier evaluation skipped: ${tierErr instanceof Error ? tierErr.message : String(tierErr)}`);
            }
            // ── 9. Healthcheck ──
            const health = runHealthcheck(store.baseDir);
            for (const line of formatHealthcheck(health).split("\n")) {
                api.logger.info?.(`[yaoyao-memory:health] ${line}`);
            }
            // ── 10. Register features ──
            const toolCount = registerMemoryTools(api, store, db, embedding, registry);
            // Banner
            showBanner(api.logger, {
                pluginVersion,
                toolCount,
                memoryDir: store.baseDir,
                cap,
                health,
            });
            // Hooks
            let captureDrain;
            if (config.capture?.enabled !== false) {
                const captureHandle = registerCaptureHook(api, store, db, config, verifyActive, scopeManager, llmResult?.client ?? null, audit, embedding);
                captureDrain = captureHandle?.drain?.bind(captureHandle);
            }
            if (config.recall?.enabled !== false) {
                registerRecallHook(api, db, config, embedding, scopeManager, audit);
            }
            // ── 11. Cleanup scheduler ──
            let cleanerTimer = null;
            const cleanerCfg = registry.service("cleaner");
            if (cleanerCfg) {
                const cleaner = createMemoryCleaner(store.baseDir, db, cleanerCfg, api.logger);
                const warn = cleaner.validateConfig();
                if (warn) {
                    api.logger.warn?.(`[yaoyao-memory] Cleanup config: ${warn}`);
                }
                else {
                    cleaner.cleanup();
                    // Tencent-style cleanTime: schedule at specific time (e.g. "03:00")
                    const delayMs = getNextCleanTimeMs(cleanerCfg.cleanTime);
                    if (delayMs > 0) {
                        setTimeout(() => {
                            cleaner.cleanup();
                            cleanerTimer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
                        }, delayMs).unref();
                        api.logger.info?.(`[yaoyao-memory] Memory cleaner scheduled at ${cleanerCfg.cleanTime} (in ${Math.round(delayMs / 60000)}min)`);
                    }
                    else {
                        cleanerTimer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
                        api.logger.info?.("[yaoyao-memory] Memory cleaner scheduled (daily interval)");
                    }
                }
            }
            api.on("gateway_stop", async () => {
                // Drain write queue before closing DB to prevent L1/L2 loss
                if (captureDrain) {
                    try {
                        await captureDrain();
                        api.logger.info?.("[yaoyao-memory] Write queue drained before shutdown");
                    }
                    catch (drainErr) {
                        api.logger.error?.(`[yaoyao-memory] Write queue drain failed: ${drainErr instanceof Error ? drainErr.message : String(drainErr)}`);
                    }
                }
                db.close();
                registry.closeAll(api);
                if (cleanerTimer) {
                    clearInterval(cleanerTimer);
                    cleanerTimer = null;
                }
            });
            api.logger.debug?.("[yaoyao-memory] Plugin registered");
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Plugin registration FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
