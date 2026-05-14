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
import { createMemoryCleaner } from "../utils/memory-cleaner.js";
import { runHealthcheck, formatHealthcheck } from "../utils/healthcheck.js";
import { showBanner } from "./banner.js";
import { detectLegacy, cleanupOldSkills } from "./migration.js";
import { readPluginVersion } from "./version.js";
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
            const pluginVersion = readPluginVersion();
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
            // ── 4. Migration & cleanup ──
            const migration = detectLegacy(config, api.baseDir || ".");
            if (migration.hasLegacy) {
                for (const line of migration.bannerLines) {
                    api.logger.warn?.(`[yaoyao-memory:migration] ${line}`);
                }
            }
            cleanupOldSkills(api.logger);
            // ── 5. Database init ──
            const initOk = db.init();
            if (!initOk) {
                api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
            }
            // ── 6. Healthcheck ──
            const health = runHealthcheck(store.baseDir);
            for (const line of formatHealthcheck(health).split("\n")) {
                api.logger.info?.(`[yaoyao-memory:health] ${line}`);
            }
            // ── 7. Register features ──
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
            if (config.capture?.enabled !== false) {
                registerCaptureHook(api, store, db, config, verifyActive);
            }
            if (config.recall?.enabled !== false) {
                registerRecallHook(api, db, config, embedding);
            }
            // ── 8. Cleanup scheduler ──
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
                    cleanerTimer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
                    api.logger.info?.("[yaoyao-memory] Memory cleaner scheduled (daily)");
                }
            }
            api.on("gateway_stop", async () => {
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
