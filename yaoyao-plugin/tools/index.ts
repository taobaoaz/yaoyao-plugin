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
import { createGraphTool } from "../features/graph/tool.ts";

/* ── Multi-signal search ────────── */
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

export function registerMemoryTools(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  storage?: Storage,
  embedding?: EmbeddingService | null,
  registry?: FeatureRegistry,
): number {
  const tools: Array<import("./common.ts").ToolRegistration> = [];

  // Create SearchPipeline once, share across all search tools
  const pipeline = createSearchPipeline(
    storage ?? (db as unknown as Storage),
    embedding,
  );

  /* ── Core tools (always registered) ── */
  tools.push(
    createSearchTool(pipeline),
    createMultiSignalSearchTool(db, embedding),
    createMemoryCallTool(storage ?? (db as unknown as Storage), embedding),
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

    /* ── Conflict detection (v1.6.0) ── */
    createJudgeTool(db),
    createConflictsTool(db),
  );

  /* ── Optional tools (gated by FeatureRegistry) ── */

  // Enhanced search — uses SearchPipeline, no longer needs raw embedding
  tools.push(createEnhancedSearchTool(pipeline));

  // Cloud sync
  if (registry?.isActive("cloud-sync")) {
    try { tools.push(createCloudSyncTool(store)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Unify (cross-backend status)
  try { tools.push(createUnifyTool(store)); } catch (e: unknown) {
    api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Quality analysis
  if (registry?.isActive("quality") ?? false) {
    try { tools.push(createQualityTool(store, db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Quality tool skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Retain check
  if (registry?.isActive("retain") ?? false) {
    try { tools.push(createRetainTool(store, db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Retain tool skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Knowledge graph — requires scenes directory
  if (registry?.isActive("graph") ?? false) {
    try { tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Graph tool skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Anti-hallucination verify
  if (registry?.isActive("verify") ?? false) {
    try { tools.push(createVerifyTool(db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);

  for (const tool of tools) {
    api.registerTool(tool);
  }

  return tools.length;
}
