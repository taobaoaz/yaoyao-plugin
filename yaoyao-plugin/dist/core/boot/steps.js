import { createMemoryStore } from "../../utils/memory-store.js";
import { createStorage } from "../../storage/bridge.js";
import { validateConfig, logValidationResults } from "../../utils/config-validator.js";
import { runInstallCheck, formatInstallCheck } from "../../utils/install-check.js";
import { initManifest } from "../../utils/manifest.js";
import { detectLegacy, cleanupOldSkills } from "../../entry/migration.js";
import { createMemoryCleaner, getNextCleanTimeMs, } from "../../utils/memory-cleaner.js";
import { SimpleScopeManager } from "../../utils/scope-manager.js";
import { resolveSessionSearchDirs, readCrossSessionMemories, } from "../../utils/session-recovery.js";
export { stepImportExistingMemories } from "./import-memories.js";
export function stepInstallCheck(api, config) {
    const cap = runInstallCheck();
    api.logger.info?.(`[yaoyao-memory] ${formatInstallCheck(cap)}`);
    for (const w of cap.warnings)
        api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
}
export function stepConfigValidation(api, config) {
    const results = validateConfig(config);
    logValidationResults(results, api.logger);
    if (results.some((r) => r.level === 'error')) {
        api.logger.warn?.('[yaoyao-memory] Config has errors — some features may be disabled');
    }
}
export function stepCoreInit(api, config) {
    const store = createMemoryStore(config, api.logger);
    const storage = createStorage(config, api.logger);
    storage.init();
    return { store, storage, scopeManager: new SimpleScopeManager(), audit: null };
}
export function stepManifest(storeBaseDir, pluginVersion) {
    initManifest(storeBaseDir, pluginVersion);
}
export function stepScopeManager(api, scopeManager) {
    const agentId = api.agentId;
    if (agentId)
        scopeManager.grantAccess(agentId, ['global', `agent:${agentId}`]);
}
export function stepCrossSessionRecovery(api, config, agentId) {
    try {
        const searchDirs = resolveSessionSearchDirs({
            context: (api.context || {}),
            cfg: api.pluginConfig || {},
            workspaceDir: api.baseDir || '.',
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
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory]  best-effort : ${msg}`);
    }
}
export function stepMigration(api, config) {
    const m = detectLegacy(config, api.baseDir || '.');
    if (m.hasLegacy)
        m.bannerLines.forEach((l) => api.logger.warn?.(`[yaoyao-memory:migration] ${l}`));
    cleanupOldSkills(api.logger);
}
export function stepCleanupScheduler(api, config, storage) {
    let timer = null;
    let timeout = null;
    try {
        const cfg = (typeof config.cleaner === 'object' ? config.cleaner : {});
        const baseDir = (config.memoryDir || '.');
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
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory]  best-effort : ${msg}`);
    }
    return {
        cleanupStop: () => {
            if (timeout)
                clearTimeout(timeout);
            if (timer)
                clearInterval(timer);
        },
    };
}
