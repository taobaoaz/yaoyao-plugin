/**
 * core/app.ts — Yaoyao Application Bootstrap.
 *
 * Orchestrator (~100 lines). Each step lives in core/boot/steps.ts.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { createFeatureRegistry } from "../optional/registry.ts";
import {
  embeddingFeature, llmFeature, cloudSyncFeature,
  verifyFeature, cleanerFeature, qualityFeature,
  retainFeature, graphFeature,
} from "../optional/index.ts";
import { registerMemoryTools } from "../tools/index.ts";
import { registerCaptureHook } from "../hooks/auto-capture.ts";
import { registerRecallHook } from "../hooks/auto-recall.ts";
import { registerCommandNewHook } from "../hooks/command-new.ts";
import { registerHeartbeatRecallHook } from "../hooks/heartbeat-recall.ts";
import { readPluginVersion } from "../entry/version.ts";
import { createAuditLog } from "../utils/audit-log.ts";
import { runStartupTasks } from "./boot/startup-tasks.ts";
import {
  stepInstallCheck, stepConfigValidation, stepCoreInit,
  stepManifest, stepScopeManager, stepCrossSessionRecovery,
  stepMigration, stepCleanupScheduler,
  stepImportExistingMemories,
} from "./boot/steps.ts";
import { runHealthcheck, runInstallCheck, formatInstallCheck, detectScheduledResetRisks, formatResetRiskReport } from "../utils/check-barrel.ts";
import { showBanner } from "../entry/banner.ts";

export function bootstrapYaoyao(
  api: OpenClawPluginApi,
  config: YaoyaoMemoryConfig,
): { drain?: () => Promise<void> } {
  const pluginVersion = readPluginVersion();
  const audit = createAuditLog(config.memoryDir || ".", api.logger, { bufferSize: 50, flushIntervalMs: 5000 });
  const cap = runInstallCheck();

  // ── 1. Platform detection & config ──
  api.logger.info?.(`[yaoyao-memory] ${formatInstallCheck(cap)}`);

  // ── 1.5. Detect scheduled reset risks ──
  const resetRisks = detectScheduledResetRisks(config.memoryDir || ".", config);
  if (resetRisks.length > 0) {
    api.logger.warn?.(`[yaoyao-memory] Detected ${resetRisks.length} scheduled reset risk(s):`);
    for (const risk of resetRisks) {
      const level = risk.severity === "critical" ? "error" : risk.severity === "warning" ? "warn" : "info";
      api.logger[level]?.(`[yaoyao-memory:reset-risk] ${risk.source}: ${risk.description}`);
    }
  }
  for (const w of cap.warnings) api.logger.warn?.(`[yaoyao-memory:install] ${w}`);
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
  const embedding = registry.service<ReturnType<typeof import("../utils/embedding.ts").createEmbeddingService>>("embedding");
  const llmResult = registry.service<import("../utils/llm-client.ts").CreateLLMClientResult>("llm");
  if (llmResult?.client) api.logger.info?.(`[yaoyao-memory] LLM client: ${llmResult.client.config.model}`);

  // ── 5. Import existing workspace memories (MEMORY.md + memory/*.md) ──
  stepImportExistingMemories(api.logger, api.baseDir || ".", config, store, storage);

  // ── 6. Cross-session recovery & migration ──
  const agentId = (api as unknown as Record<string, unknown>).agentId as string | undefined;
  stepCrossSessionRecovery(api, config, agentId);
  stepMigration(api, config);

  // ── 6. Deferred startup tasks ──
  setTimeout(() => runStartupTasks(api, config, storage, store), 100);

  // ── 7. Register tools & hooks ──
  const toolCount = registerMemoryTools(api, store, storage, storage, embedding, registry);
  const health = runHealthcheck(store.baseDir);
  showBanner(api.logger, { pluginVersion, toolCount, memoryDir: store.baseDir, cap: runInstallCheck(), health });

  let captureDrain: (() => Promise<void>) | undefined;
  if (config.capture?.enabled !== false) {
    const capHandle = registerCaptureHook(api, store, storage, config, registry.isActive("verify"), scopeManager, llmResult?.client ?? null, audit, embedding);
    captureDrain = capHandle?.drain?.bind(capHandle);
  }
  if (config.recall?.enabled !== false) {
    registerRecallHook(api, storage, config, embedding, scopeManager, audit);
  }

  // ── Session boundary cleanup for /new and /reset ──
  let commandNewHandle: import("../hooks/command-new.ts").CommandNewHookHandle | undefined;
  if (config.hooks?.commandNew?.enabled !== false) {
    commandNewHandle = registerCommandNewHook(api);
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
    if (captureDrain) { try { await captureDrain(); api.logger.info?.("[yaoyao-memory] Write queue drained"); } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      api.logger.warn?.(`[yaoyao-memory] Drain failed: ${msg}`);
    } }
    commandNewHandle?.unregister();
    storage.close();
    cleanupStop();
    api.logger.debug?.("[yaoyao-memory] Plugin stopped");
  });

  api.logger.debug?.("[yaoyao-memory] Plugin started");
  return { drain: captureDrain };
}
