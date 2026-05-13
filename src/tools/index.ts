/**
 * Tool index — registers all yaoyao-memory tools.
 * Tool logic lives in src/features/<feature>/tool.ts.
 * Core algorithms are in src/core/<domain>/.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import type { EmbeddingService } from "../utils/embedding.js";

/* ── Search ─────────────────────────────────────────── */
import { createSearchTool } from "../features/search/tool.js";
import { createGetTool } from "../features/get/tool.js";
import { createListTool } from "../features/list/tool.js";
import { createSearchTimelineTool } from "../features/search-timeline/tool.js";
import { createEnhancedSearchTool } from "../features/enhanced-search/tool.js";

/* ── Management ────────────────────────────────────── */
import { createSaveTool } from "../features/save/tool.js";
import { createNoteTool } from "../features/note/tool.js";
import { createForgetTool } from "../features/forget/tool.js";
import { createTagTool } from "../features/tag/tool.js";
import { createBackupTool } from "../features/backup/tool.js";
import { createExportTool } from "../features/export/tool.js";
import { createCloudSyncTool } from "../features/cloud-sync/tool.js";
import { createUnifyTool } from "../features/unify/tool.js";

/* ── Analysis ──────────────────────────────────────── */
import { createStatsTool } from "../features/stats/tool.js";
import { createTimelineTool } from "../features/timeline/tool.js";
import { createTrendsTool } from "../features/trends/tool.js";
import { createQualityTool } from "../features/quality/tool.js";
import { createRetainTool } from "../features/retain/tool.js";
import { createGraphTool } from "../features/graph/tool.js";

/* ── Import ────────────────────────────────────────── */
import { createImportTool } from "../features/import/tool.js";
import { createImportOCTool } from "../features/import-oc/tool.js";
import { createImportWorkspaceTool } from "../features/import-workspace/tool.js";

/* ── System ────────────────────────────────────────── */
import { createRecommendTool } from "../features/recommend/tool.js";
import { createRemindTool } from "../features/remind/tool.js";
import { createHealthcheckTool } from "../features/healthcheck/tool.js";

/* ── Anti-hallucination ───────────────────────────── */
import { createVerifyTool } from "../features/verify/tool.ts";

export function registerMemoryTools(api: OpenClawPluginApi, store: MemoryStore, db: DBBridge, embedding?: EmbeddingService | null) {
  const tools: Array<import("./common.js").ToolRegistration> = [];

  /* ── Search ── */
  tools.push(
    createSearchTool(db),
    createGetTool(store, db),
    createListTool(store),
    createSearchTimelineTool(db),
  );

  /* ── Management ── */
  tools.push(
    createSaveTool(store, db),
    createNoteTool(store, db),
    createForgetTool(store, db),
    createTagTool(store, db),
    createBackupTool(store),
    createExportTool(db),
  );

  /* ── Import ── */
  tools.push(
    createImportTool(store),
    createImportOCTool(store, db),
    createImportWorkspaceTool(store, db),
  );

  /* ── Analysis ── */
  tools.push(
    createStatsTool(store, db),
    createTimelineTool(db),
    createTrendsTool(store),
  );

  /* ── System ── */
  tools.push(
    createRecommendTool(db, store.baseDir),
    createRemindTool(),
    createHealthcheckTool(),
  );

  /* ── Best-effort / optional ── */

  // Graph (knowledge graph) — requires scenes directory
  try { tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding)); } catch { /* skip */ }

  // Enhanced search — vector rerank + keyword highlight
  if (embedding) {
    try { tools.push(createEnhancedSearchTool(db, embedding)); } catch { /* skip */ }
  } else {
    try { tools.push(createEnhancedSearchTool(db)); } catch { /* skip */ }
  }

  // Quality, Retain, Trends — best-effort
  try { tools.push(createQualityTool(store, db)); } catch { /* skip */ }
  try { tools.push(createRetainTool(store, db)); } catch { /* skip */ }

  // Cloud sync — graceful when no credentials
  try { tools.push(createCloudSyncTool(store)); } catch (e: unknown) {
    api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${(e as Error).message}`);
  }

  // Unified memory — cross-backend status
  try { tools.push(createUnifyTool(store)); } catch (e: unknown) {
    api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${(e as Error).message}`);
  }

  /* ── Anti-hallucination ── */
  try { tools.push(createVerifyTool(db)); } catch (e: unknown) {
    api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${(e as Error).message}`);
  }

  api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);

  for (const tool of tools) {
    api.registerTool(tool);
  }

  return tools.length;
}
