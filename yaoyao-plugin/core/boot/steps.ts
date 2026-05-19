/**
 * core/boot/steps.ts — Individual bootstrap steps.
 *
 * Each step is a standalone function that takes (api, config, ...)
 * and returns its result. The orchestrator calls these in order.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import { createMemoryStore } from "../../utils/memory-store.ts";
import { createStorage, type Storage } from "../../storage/bridge.ts";
import { validateConfig, logValidationResults } from "../../utils/config-validator.ts";
import { runInstallCheck, formatInstallCheck } from "../../utils/install-check.ts";
import { initManifest } from "../../utils/manifest.ts";
import { detectLegacy, cleanupOldSkills } from "../../entry/migration.ts";
import { createMemoryCleaner, getNextCleanTimeMs, type CleanerConfig } from "../../utils/memory-cleaner.ts";
import { SimpleScopeManager } from "../../utils/scope-manager.ts";
import { resolveSessionSearchDirs, readCrossSessionMemories } from "../../utils/session-recovery.ts";

export interface BootContext {
  store: ReturnType<typeof createMemoryStore>;
  storage: Storage;
  scopeManager: SimpleScopeManager;
  audit: import("../../utils/audit-log.ts").AuditLog | null;
}

export function stepInstallCheck(api: OpenClawPluginApi, config: YaoyaoMemoryConfig): void {
  const cap = runInstallCheck();
  api.logger.info?.(`[yaoyao-memory] ${formatInstallCheck(cap)}`);
  for (const w of cap.warnings) api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
}

export function stepConfigValidation(api: OpenClawPluginApi, config: YaoyaoMemoryConfig): void {
  const results = validateConfig(config);
  logValidationResults(results, api.logger);
  if (results.some(r => r.level === "error")) {
    api.logger.warn?.("[yaoyao-memory] Config has errors — some features may be disabled");
  }
}

export function stepCoreInit(api: OpenClawPluginApi, config: YaoyaoMemoryConfig): BootContext {
  const store = createMemoryStore(config, api.logger);
  const storage = createStorage(config, api.logger);
  storage.init();
  return { store, storage, scopeManager: new SimpleScopeManager(), audit: null };
}

export function stepManifest(storeBaseDir: string, pluginVersion: string): void {
  initManifest(storeBaseDir, pluginVersion);
}

export function stepScopeManager(api: OpenClawPluginApi, scopeManager: SimpleScopeManager): void {
  const agentId = (api as unknown as Record<string, unknown>).agentId as string | undefined;
  if (agentId) scopeManager.grantAccess(agentId, ["global", `agent:${agentId}`]);
}

export function stepCrossSessionRecovery(api: OpenClawPluginApi, config: YaoyaoMemoryConfig, agentId?: string): void {
  try {
    const searchDirs = resolveSessionSearchDirs({
      context: ((api as unknown as Record<string, unknown>).context || {}) as Record<string, unknown>,
      cfg: api.pluginConfig || {},
      workspaceDir: api.baseDir || ".",
      currentSessionFile: (api as unknown as Record<string, unknown>).sessionFile as string | undefined,
      sourceAgentId: agentId,
    });
    const memories = readCrossSessionMemories(searchDirs, {
      maxMemories: (config.sessionRecovery?.maxMemories as number) ?? 10,
      maxAgeMs: (config.sessionRecovery?.maxAgeMs as number) ?? 7 * 24 * 60 * 60 * 1000,
    });
    if (memories.length > 0) {
      api.logger.info?.(`[yaoyao-memory] Loaded ${memories.length} cross-session memories`);
      (api as unknown as Record<string, unknown>)._crossSessionContext = memories;
    }
  } catch { /* best-effort */ }
}

export function stepMigration(api: OpenClawPluginApi, config: YaoyaoMemoryConfig): void {
  const m = detectLegacy(config, api.baseDir || ".");
  if (m.hasLegacy) m.bannerLines.forEach(l => api.logger.warn?.(`[yaoyao-memory:migration] ${l}`));
  cleanupOldSkills(api.logger);
}

export function stepCleanupScheduler(
  api: OpenClawPluginApi,
  config: YaoyaoMemoryConfig,
  storage: Storage,
): { cleanupStop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const cfg = (typeof config.cleaner === "object" ? config.cleaner : {}) as CleanerConfig;
    const baseDir = (config.memoryDir || ".") as string;
    const cleaner = createMemoryCleaner(baseDir, storage, cfg, api.logger);
    const warn = cleaner.validateConfig();
    if (warn) { api.logger.warn?.(`[yaoyao-memory] Cleanup: ${warn}`); }
    else {
      cleaner.cleanup();
      const delayMs = getNextCleanTimeMs(cfg.cleanTime as string);
      if (delayMs > 0) {
        timeout = setTimeout(() => {
          cleaner.cleanup();
          timer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
        }, delayMs);
        if (timeout) timeout.unref();
      } else {
        timer = setInterval(() => cleaner.cleanup(), 24 * 60 * 60 * 1000).unref();
      }
    }
  } catch { /* best-effort */ }
  return {
    cleanupStop: () => { if (timeout) clearTimeout(timeout); if (timer) clearInterval(timer); },
  };
}
