/**
 * Tool index — registers all yaoyao-memory tools.
 *
 * Tool logic lives in src/features/<feature>/tool.ts.
 * Core algorithms are in src/core/<domain>/.
 *
 * Optional tools are gated by the FeatureRegistry so enabling/disabling
 * is declarative and consistent across entry + tools + hooks.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
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

export function registerMemoryTools(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  storage?: Storage,
  embedding?: EmbeddingService | null,
  registry?: FeatureRegistry,
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

    /* ── v1.8.0: Workspace file access ── */
    createWorkspaceTool(store),
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

  api.logger.info(`[yaoyao-memory] ${tools.length} tools prepared for registration`);

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
