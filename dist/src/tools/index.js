import { createSearchPipeline } from "../core/search/pipeline.js";
/* ── Search (use SearchPipeline) ────────────────── */
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
/* ── Multi-signal search (mem0 v3 style) ────────── */
import { createMultiSignalSearchTool } from "../features/multi-signal/tool.js";
/* ── Structured MemoryCall search (MemOS-style) ─── */
import { createMemoryCallTool } from "../features/memory-call/tool.js";
/* ── Import ────────────────────────────────────────── */
import { createImportTool } from "../features/import/tool.js";
import { createImportOCTool } from "../features/import-oc/tool.js";
import { createImportWorkspaceTool } from "../features/import-workspace/tool.js";
/* ── System ────────────────────────────────────────── */
import { createRecommendTool } from "../features/recommend/tool.js";
import { createRemindTool } from "../features/remind/tool.js";
import { createHealthcheckTool } from "../features/healthcheck/tool.js";
/* ── Conflict detection ─────────────────────────── */
import { createJudgeTool, createConflictsTool } from "../features/conflict/tool.js";
/* ── Anti-hallucination ───────────────────────────── */
import { createVerifyTool } from "../features/verify/tool.js";
export function registerMemoryTools(api, store, db, storage, embedding, registry) {
    const tools = [];
    // Create SearchPipeline once, share across all search tools
    const pipeline = createSearchPipeline(storage ?? db, embedding);
    /* ── Core tools (always registered) ── */
    tools.push(createSearchTool(pipeline), createMultiSignalSearchTool(db, embedding), createMemoryCallTool(storage ?? db, embedding), createGetTool(store, db), createListTool(store), createSearchTimelineTool(pipeline), createSaveTool(store, db, true), createNoteTool(store, db), createForgetTool(store, db), createTagTool(store, db), createBackupTool(store), createExportTool(db), createImportTool(store), createImportOCTool(store, db), createImportWorkspaceTool(store, db), createStatsTool(store, db), createTimelineTool(db), createTrendsTool(store), createRecommendTool(db, store.baseDir), createRemindTool(), createHealthcheckTool(), 
    /* ── Conflict detection (v1.6.0) ── */
    createJudgeTool(db), createConflictsTool(db));
    /* ── Optional tools (gated by FeatureRegistry) ── */
    // Enhanced search — uses SearchPipeline, no longer needs raw embedding
    tools.push(createEnhancedSearchTool(pipeline));
    // Cloud sync
    if (registry?.isActive("cloud-sync")) {
        try {
            tools.push(createCloudSyncTool(store));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${e.message}`);
        }
    }
    // Unify (cross-backend status)
    try {
        tools.push(createUnifyTool(store));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${e.message}`);
    }
    // Quality analysis
    if (registry?.isActive("quality") ?? true) {
        try {
            tools.push(createQualityTool(store, db));
        }
        catch { /* skip */ }
    }
    // Retain check
    if (registry?.isActive("retain") ?? true) {
        try {
            tools.push(createRetainTool(store, db));
        }
        catch { /* skip */ }
    }
    // Knowledge graph — requires scenes directory
    if (registry?.isActive("graph") ?? true) {
        try {
            tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding));
        }
        catch { /* skip */ }
    }
    // Anti-hallucination verify
    if (registry?.isActive("verify") ?? true) {
        try {
            tools.push(createVerifyTool(db));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${e.message}`);
        }
    }
    api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);
    for (const tool of tools) {
        api.registerTool(tool);
    }
    return tools.length;
}
