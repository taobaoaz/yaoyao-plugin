/**
 * Tool index — registers all yaoyao-memory tools.
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

/* ── Search ─────────────────────────────────────────── */
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

/* ── Import ────────────────────────────────────────── */
import { createImportTool } from "../features/import/tool.ts";
import { createImportOCTool } from "../features/import-oc/tool.ts";
import { createImportWorkspaceTool } from "../features/import-workspace/tool.ts";

/* ── System ────────────────────────────────────────── */
import { createRecommendTool } from "../features/recommend/tool.ts";
import { createRemindTool } from "../features/remind/tool.ts";
import { createHealthcheckTool } from "../features/healthcheck/tool.ts";

/* ── Anti-hallucination ───────────────────────────── */
import { createVerifyTool } from "../features/verify/tool.ts";

export function registerMemoryTools(
  api: OpenClawPluginApi,
  store: MemoryStore,
  db: DBBridge,
  embedding?: EmbeddingService | null,
  registry?: FeatureRegistry,
) {
  const tools: Array<import("./common.ts").ToolRegistration> = [];

  /* ── Core tools (always registered) ── */
  tools.push(
    createSearchTool(db),
    createGetTool(store, db),
    createListTool(store),
    createSearchTimelineTool(db),
    createSaveTool(store, db),
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
  );

  /* ── Optional tools (gated by FeatureRegistry) ── */

  // Enhanced search — requires embedding
  if (embedding) {
    try { tools.push(createEnhancedSearchTool(db, embedding)); } catch { /* skip */ }
  } else {
    try { tools.push(createEnhancedSearchTool(db)); } catch { /* skip */ }
  }

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
    try { tools.push(createQualityTool(store, db)); } catch { /* skip */ }
  }

  // Retain check
  if (registry?.isActive("retain") ?? true) {
    try { tools.push(createRetainTool(store, db)); } catch { /* skip */ }
  }

  // Knowledge graph — requires scenes directory
  if (registry?.isActive("graph") ?? true) {
    try { tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding)); } catch { /* skip */ }
  }

  // Anti-hallucination verify
  if (registry?.isActive("verify") ?? true) {
    try { tools.push(createVerifyTool(db)); } catch (e: unknown) {
      api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${(e as Error).message}`);
    }
  }

  api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);

  for (const tool of tools) {
    api.registerTool(tool);
  }

  return tools.length;
}
