import { createMemoryStore } from "../../utils/memory-store.js";
import { createStorage } from "../../storage/bridge.js";
import { validateConfig, logValidationResults } from "../../utils/config-validator.js";
import { runInstallCheck, formatInstallCheck } from "../../utils/install-check.js";
import { initManifest } from "../../utils/manifest.js";
import { detectLegacy, cleanupOldSkills } from "../../entry/migration.js";
import { createMemoryCleaner, getNextCleanTimeMs } from "../../utils/memory-cleaner.js";
import { SimpleScopeManager } from "../../utils/scope-manager.js";
import { resolveSessionSearchDirs, readCrossSessionMemories } from "../../utils/session-recovery.js";
import { runMigrationV190 } from "../../storage/migration-v190.js";
export function stepInstallCheck(api, config) {
    const cap = runInstallCheck();
    api.logger.info?.(`[yaoyao-memory] ${formatInstallCheck(cap)}`);
    for (const w of cap.warnings)
        api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
}
export function stepConfigValidation(api, config) {
    const results = validateConfig(config);
    logValidationResults(results, api.logger);
    if (results.some(r => r.level === "error")) {
        api.logger.warn?.("[yaoyao-memory] Config has errors — some features may be disabled");
    }
}
export function stepCoreInit(api, config) {
    const store = createMemoryStore(config, api.logger);
    const storage = createStorage(config, api.logger);
    const initResult = storage.init();
    if (!initResult) {
        api.logger.warn?.("[yaoyao-memory] Storage init returned false — some features may be unavailable");
    }
    return { store, storage, scopeManager: new SimpleScopeManager(), audit: null };
}
export function stepManifest(storeBaseDir, pluginVersion) {
    initManifest(storeBaseDir, pluginVersion);
}
export function stepScopeManager(api, scopeManager) {
    const agentId = api.agentId;
    if (agentId)
        scopeManager.grantAccess(agentId, ["global", `agent:${agentId}`]);
}
export function stepCrossSessionRecovery(api, config, agentId) {
    try {
        const searchDirs = resolveSessionSearchDirs({
            context: (api.context || {}),
            cfg: api.pluginConfig || {},
            workspaceDir: api.baseDir || ".",
            currentSessionFile: api.sessionFile,
            sourceAgentId: agentId,
        });
        const memories = readCrossSessionMemories(searchDirs, {
            maxMemories: config.sessionRecovery?.maxMemories ?? 10,
            maxAgeMs: config.sessionRecovery?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
        });
        if (memories.length > 0) {
            api.logger.info?.(`[yaoyao-memory] Loaded ${memories.length} cross-session memories`);
            api._crossSessionContext = memories;
        }
    }
    catch (err) {
        api.logger.debug?.(`[yaoyao-memory] Cross-session recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export function stepMigration(api, config) {
    const m = detectLegacy(config, api.baseDir || ".");
    if (m.hasLegacy)
        m.bannerLines.forEach(l => api.logger.warn?.(`[yaoyao-memory:migration] ${l}`));
    cleanupOldSkills(api.logger);
    // v1.9.0: also run the DB-unification migration. This is independent
    // of the v1.4.x→v1.5.0 detection above; it only touches the SQLite
    // file (legacy `.yaoyao.db` → shared `main.sqlite`) and is fully
    // idempotent.
    try {
        const memoryDir = config.memoryDir || ".";
        const res = runMigrationV190({ memoryDir, logger: api.logger });
        if (res.ran) {
            api.logger.info?.(`[yaoyao-memory:migrate-v190] Done: ${res.rowsMoved} rows from ${res.legacyPath} → ${res.targetPath}` +
                (res.backupPath ? ` (backup: ${res.backupPath})` : ""));
        }
        else {
            api.logger.debug?.(`[yaoyao-memory:migrate-v190] Skipped: ${res.reason}`);
        }
    }
    catch (err) {
        api.logger.warn?.(`[yaoyao-memory:migrate-v190] Unexpected failure: ${err.message}`);
    }
}
export function stepCleanupScheduler(api, config, storage) {
    let timer = null;
    let timeout = null;
    try {
        const cfg = (typeof config.cleanup === "object" ? config.cleanup : {});
        const baseDir = (config.memoryDir || ".");
        const cleaner = createMemoryCleaner(baseDir, storage, cfg, api.logger);
        const warn = cleaner.validateConfig();
        if (warn) {
            api.logger.warn?.(`[yaoyao-memory] Cleanup: ${warn}`);
        }
        else {
            cleaner.cleanup();
            const delayMs = getNextCleanTimeMs(cfg.cleanTime);
            if (delayMs > 0) {
                timeout = setTimeout(() => {
                    cleaner.cleanup();
                    timer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
                }, delayMs);
                if (timeout)
                    timeout.unref();
            }
            else {
                timer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
            }
        }
    }
    catch (err) {
        api.logger.debug?.(`[yaoyao-memory] Cleanup scheduler init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
        cleanupStop: () => { if (timeout)
            clearTimeout(timeout); if (timer)
            clearInterval(timer); },
    };
}
