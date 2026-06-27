/**
 * Tool index — registers all yaoyao-memory tools.
 *
 * Tool logic lives in src/features/<feature>/tool.ts.
 * Core algorithms are in src/core/<domain>/.
 *
 * Optional tools are gated by the FeatureRegistry so enabling/disabling
 * is declarative and consistent across entry + tools + hooks.
 */
import type { OpenClawPluginApi } from "../openclaw-sdk/plugin-entry.ts";
import type { MemoryStore } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";
import type { EmbeddingService } from "../utils/embedding.ts";
import type { FeatureRegistry } from "../optional/registry.ts";
import type { Storage } from "../storage/bridge.ts";
import { createSearchPipeline, type SearchPipeline } from "../core/search/pipeline.ts";

/* ── Search (use SearchPipeline) ────────────────── */
import { createSearchTool } from "../features/search/tool.ts";
import { createGetTool } from "../features/get/tool.ts";
import { createListTool } from "../features/list/tool.ts";
import { createSearchTimelineTool } from "../features/search-timeline/tool.ts";
import { createEnhancedSearchTool } from "../features/enhanced-search/tool.ts";

/* ── Management ────────────────────────────────────── */
import { createSaveTool } from "../features/save/tool.ts";
import { createNoteTool } from "../features/note/tool.ts";
import { createForgetTool } from "../features/forget/tool.ts";
import { createTagTool } from "../features/tag/tool.ts";
import { createBackupTool } from "../features/backup/tool.ts";
import { createExportTool } from "../features/export/tool.ts";
import { createCloudSyncTool } from "../features/cloud-sync/tool.ts";
import { createUnifyTool } from "../features/unify/tool.ts";

/* ── Analysis ──────────────────────────────────────── */
import { createStatsTool } from "../features/stats/tool.ts";
import { createTimelineTool } from "../features/timeline/tool.ts";
import { createTrendsTool } from "../features/trends/tool.ts";
import { createQualityTool } from "../features/quality/tool.ts";
import { createRetainTool } from "../features/retain/tool.ts";
import { createAnalyzeTool } from "../features/analyze/tool.ts";
import { createGraphTool } from "../features/graph/tool.ts";

/* ── Multi-signal search (mem0 v3 style) ────────── */
import { createMultiSignalSearchTool } from "../features/multi-signal/tool.ts";

/* ── Structured MemoryCall search style ─── */
import { createMemoryCallTool } from "../features/memory-call/tool.ts";

/* ── Cron management (v1.6.0+) ───────────────────── */
import { createCronTool } from "../features/cron/tool.ts";
import { createImportTool } from "../features/import/tool.ts";
import { createImportOCTool } from "../features/import-oc/tool.ts";
import { createImportWorkspaceTool } from "../features/import-workspace/tool.ts";

/* ── System ────────────────────────────────────────── */
import { createRecommendTool } from "../features/recommend/tool.ts";
import { createRemindTool } from "../features/remind/tool.ts";
import { createHealthcheckTool } from "../features/healthcheck/tool.ts";

/* ── Conflict detection ─────────────────────────── */
import { createJudgeTool, createConflictsTool } from "../features/conflict/tool.ts";
import { createAutoResolveTool } from "../features/auto-resolve/tool.ts";

/* ── Anti-hallucination ───────────────────────────── */
import { createVerifyTool } from "../features/verify/tool.ts";

/* ── Telemetry ─────────────────────────────────────── */
import { createTelemetryTool } from "../features/telemetry/tool.ts";

/* ── Graph relations (Phase 1) ─────────────────────── */
import { createGraphRelationTool } from "../features/graph-relation/tool.ts";

/* ── Atomic facts (Phase 2) ────────────────────────── */
import { createAtomicFactTool } from "../features/atomic-fact/tool.ts";

/* ── Adaptive search (Phase 3) ─────────────────────── */
import { createAdaptiveSearchTool } from "../features/adaptive-search/tool.ts";

/* ── Skill analytics (Phase 4) ────────────────────── */
import { createSkillAnalyticsTool } from "../features/skill-analytics/tool.ts";

/* ── Benchmark (Phase 5) ───────────────────────────── */
import { createBenchmarkTool } from "../features/benchmark/tool.ts";

/* ── Workspace files (v1.8.0) ─────────────────────── */
import { createWorkspaceTool } from "../features/workspace/tool.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store-types.ts";

/* ── Multimodal memory (v1.8.x hidden feature, gated by config) ── */
import { createMultimodalTool } from "../features/multimodal/tool.ts";
import {
  recordAndClassify,
  resolveCurrentModel,
  isMultimodalCapable,
} from "../utils/model-capabilities.ts";

/* ── v1.9.1: memory-celia coexistence delegation ── */
import { isCeliaActive } from "../utils/coexistence.ts";
import { getCeliaClient, resolveCeliaBinaryPath } from "../celia/client.ts";
import { applyCeliaDelegation, type DelegateContext } from "../celia/delegate.ts";
import { createCeliaProxyTools, createCeliaReadOnlyTool } from "../celia/proxy-tools.ts";
import { CeliaDbReader } from "../celia/db-reader.ts";
import { normalizeBridgeMode } from "../celia/mode.ts";

export function registerMemoryTools(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  storage?: Storage,
  embedding?: EmbeddingService | null,
  registry?: FeatureRegistry,
  config?: YaoyaoMemoryConfig,
) {
  const tools: Array<import("./common.ts").ToolRegistration> = [];

  // Create SearchPipeline once, share across all search tools
  const safeStorage = storage ?? (db as unknown as Storage);
  const pipeline = createSearchPipeline(safeStorage, embedding);

  /* ── Core tools (always registered) ── */
  tools.push(
    createSearchTool(pipeline),
    createMultiSignalSearchTool(db, embedding),
    createMemoryCallTool(safeStorage, embedding),
    createGetTool(store, db),
    createListTool(store),
    createSearchTimelineTool(pipeline),
    createSaveTool(store, db, true),
    createNoteTool(store, db),
    createForgetTool(store, db),
    createTagTool(store, db),
    createBackupTool(store),
    createExportTool(db),
    createImportTool(store),
    createImportOCTool(store, db),
    createImportWorkspaceTool(store, db),
    createStatsTool(store, db),
    createTimelineTool(db),
    createTrendsTool(store),
    createRecommendTool(db, store.baseDir),
    createRemindTool(),
    createHealthcheckTool(),
    createCronTool(api),
    createTelemetryTool({
      enabled: process.env.YAOYAO_TELEMETRY !== "0",
      url: process.env.YAOYAO_TELEMETRY_URL,
    }),

    /* ── Phase 1-5: Advanced memory features ── */
    createGraphRelationTool(),
    createAtomicFactTool(),
    createAdaptiveSearchTool(),
    createSkillAnalyticsTool(),
    createBenchmarkTool(),
    createJudgeTool(db),
    createConflictsTool(db),
    /* ── v1.9.0: Auto-resolve conflict pairs based on recency + source + access + importance ── */
    createAutoResolveTool(db),

    /* ── v1.8.0: Workspace file access ── */
    createWorkspaceTool(store),
    /* ── v1.8.3: memory_analyze placeholder (redirects to yaoyao-soul plugin) ── */
    createAnalyzeTool(),
  );

  /* ── Optional tools (gated by FeatureRegistry) ── */

  // Enhanced search — uses SearchPipeline, no longer needs raw embedding
  tools.push(createEnhancedSearchTool(pipeline));

  // Cloud sync
  if (registry?.isActive("cloud-sync")) {
    try { tools.push(createCloudSyncTool(store)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${(e as Error).message}`);
    }
  }

  // Unify (cross-backend status)
  try { tools.push(createUnifyTool(store)); } catch (e: unknown) {
    api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${(e as Error).message}`);
  }

  // Quality analysis
  if (registry?.isActive("quality") ?? true) {
    try { tools.push(createQualityTool(store, db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Quality tool skipped: ${(e as Error).message}`);
    }
  }

  // Retain check
  if (registry?.isActive("retain") ?? true) {
    try { tools.push(createRetainTool(store, db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Retain tool skipped: ${(e as Error).message}`);
    }
  }

  // Knowledge graph — requires scenes directory
  if (registry?.isActive("graph") ?? true) {
    try { tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Graph tool skipped: ${(e as Error).message}`);
    }
  }

  // Anti-hallucination verify
  if (registry?.isActive("verify") ?? true) {
    try { tools.push(createVerifyTool(db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${(e as Error).message}`);
    }
  }

  // v1.8.x: Multimodal memory — hidden feature, default off.
  if (config?.multimodal?.enabled === true) {
    // v1.8.3+: gate on the active LLM model. If it's not multimodal-capable,
    // silently skip registration and warn (standard OpenClaw users unaffected).
    const currentModel = resolveCurrentModel(config as unknown as Record<string, unknown>);
    if (!currentModel) {
      api.logger.warn?.(
        `[yaoyao-memory] multimodal.enabled=true but no LLM model resolved from config; ` +
        `memory_multimodal will not be registered. Configure llm.model or embedding.model.`
      );
    } else {
      const caps = recordAndClassify(store.baseDir, currentModel);
      if (!isMultimodalCapable(caps)) {
        api.logger.warn?.(
          `[yaoyao-memory] multimodal.enabled=true but active model "${currentModel}" is not ` +
          `multimodal-capable (image=${caps.image}, audio=${caps.audio}, video=${caps.video}, ` +
          `source=${caps.source}, note="${caps.note ?? ""}"). memory_multimodal will not be ` +
          `registered. Switch to a multimodal model (gpt-4o, claude-3+, gemini-1.5+, qwen-vl, etc.) ` +
          `to enable. Detection cached to model-capabilities.json.`
        );
      } else {
        try {
          tools.push(createMultimodalTool({
            storageDir: config.multimodal.storageDir,
            maxFileSizeMb: config.multimodal.maxFileSizeMb,
          }));
          api.logger.info?.(
            `[yaoyao-memory] memory_multimodal enabled for model "${currentModel}" ` +
            `(caps: image=${caps.image}, audio=${caps.audio}, video=${caps.video}, source=${caps.source})`
          );
        } catch (e: unknown) {
          api.logger.warn?.(`[yaoyao-memory] Multimodal tool skipped: ${(e as Error).message}`);
        }
      }
    }
  }

  api.logger.info(`[yaoyao-memory] ${tools.length} tools prepared for registration`);

  // ── v1.9.1: celia coexistence bridge (three modes) ──
  // Active only when celia owns the slot AND celiaBridge.enabled=true.
  //   mode="delegate" (default): spawn celia MCP server, wrap overlapping tools
  //     to delegate, and add celia-unique proxy tools (dream/scene/global/flush).
  //   mode="read-only": NO spawn. Open celia's db read-only and expose a single
  //     memory_celia_browse tool. No writes, no process, safest.
  //   enabled=false: skipped entirely (standalone env or opt-out).
  const bridgeCfg = (config as Record<string, unknown>).celiaBridge as
    | { enabled?: boolean; mode?: string; serverBinaryPath?: string; dbPath?: string }
    | undefined;
  const celiaActive = isCeliaActive();
  if (celiaActive && bridgeCfg?.enabled === true) {
    // Normalize mode: "read-only" and "readonly" both map to the read-only path
    // (config guides spell it inconsistently). See celia/mode.ts.
    const mode = normalizeBridgeMode(bridgeCfg.mode);

    if (mode === "readonly") {
      // ── read-only: no spawn, just open the db read-only ──
      try {
        const dbPath = CeliaDbReader.resolvePath(bridgeCfg.dbPath);
        const reader = new CeliaDbReader(dbPath, api.logger);
        tools.push(createCeliaReadOnlyTool(reader, api.logger));
        api.logger.info?.(`[yaoyao-memory] celia bridge READ-ONLY — memory_celia_browse registered (db: ${dbPath})`);
      } catch (e: unknown) {
        api.logger.warn?.(`[yaoyao-memory] celia read-only bridge skipped: ${(e as Error).message}`);
      }
    } else {
      // ── delegate: spawn + wrap + proxy ──
      const binPath = resolveCeliaBinaryPath(bridgeCfg.serverBinaryPath);
      if (binPath) {
        const client = getCeliaClient({ serverBinaryPath: binPath, logger: api.logger });
        const delegateCtx: DelegateContext = { client, logger: api.logger };
        // Wrap overlapping tools with delegation (fallback-safe).
        applyCeliaDelegation(tools, delegateCtx).forEach((t, i) => { tools[i] = t; });
        // Append celia-unique proxy tools (only available through celia).
        try {
          const proxyTools = createCeliaProxyTools(client, api.logger);
          tools.push(...proxyTools);
          api.logger.info?.(`[yaoyao-memory] celia bridge DELEGATE — ${proxyTools.length} proxy tools added, overlapping tools delegate to celia`);
        } catch (e: unknown) {
          api.logger.warn?.(`[yaoyao-memory] celia proxy tools skipped: ${(e as Error).message}`);
        }
      } else {
        // Binary not found → auto-degrade to read-only so the bridge still adds value.
        api.logger.warn?.(`[yaoyao-memory] celia binary not found; auto-degrading bridge to read-only mode`);
        try {
          const dbPath = CeliaDbReader.resolvePath(bridgeCfg.dbPath);
          const reader = new CeliaDbReader(dbPath, api.logger);
          tools.push(createCeliaReadOnlyTool(reader, api.logger));
        } catch { /* read-only also unavailable: bridge fully inactive */ }
      }
    }
  }

  let registeredCount = 0;
  for (const tool of tools) {
    try {
      api.registerTool(tool);
      registeredCount++;
    } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Failed to register tool "${(tool as Record<string, unknown>).id || (tool as Record<string, unknown>).name || "unknown"}": ${(e as Error).message}`);
    }
  }
  api.logger.info(`[yaoyao-memory] ${registeredCount}/${tools.length} tools registered successfully`);

  return registeredCount;
}
