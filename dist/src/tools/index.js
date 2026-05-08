import { createSearchTool } from "./search.js";
import { createGetTool } from "./get.js";
import { createListTool } from "./list.js";
import { createSaveTool } from "./save.js";
import { createStatsTool } from "./stats.js";
import { createMoodTool } from "./mood.js";
import { createTimelineTool } from "./timeline.js";
import { createSearchTimelineTool } from "./search-timeline.js";
import { createBackupTool } from "./backup.js";
import { createForgetTool } from "./forget.js";
import { createNoteTool } from "./note.js";
import { createOptimizeTool } from "./memory-optimize.js";
import { createGraphTool } from "./memory-graph.js";
import { createEnhancedSearchTool } from "./memory-search-enhanced.js";
import { createExportTool } from "./memory-export.js";
import { createImportTool } from "./memory-import.js";
import { createTagTool } from "./memory-tag.js";
import { createRemindTool } from "./memory-remind.js";
import { createRecommendTool } from "./memory-recommend.js";
import { createTrendsTool } from "./memory-trends.js";
import { createQualityTool } from "./memory-quality.js";
import { createRetainTool } from "./memory-retain.js";
import { createCloudSyncTool } from "./cloud-sync.js";
import { createUnifyTool } from "./memory-unify.js";
import { createImportOCTool } from "./memory-import-oc.js";
import { createImportWorkspaceTool } from "./memory-import-workspace.js";
import { createInsightsTool } from "./memory-insights.js";
import { createDiffTool } from "./memory-diff.js";
import { createSuggestTool } from "./memory-suggest.js";
import { createArchiveTool } from "./memory-archive.js";
import { createSummarizeTool } from "./memory-summarize.js";
import { createSmartQueryTool } from "./smart-query.js";

export function registerMemoryTools(api, store, db, feedbackTracker, embedding) {
    const tools = [
        createSearchTool(db),
        createGetTool(store, db),
        createListTool(store),
        createSaveTool(store, db),
        createStatsTool(store, db),
        createMoodTool(store),
        createTimelineTool(db),
        createSearchTimelineTool(db),
        createBackupTool(store),
        createForgetTool(store, db),
        createNoteTool(store, db),
        createExportTool(store),
        createImportTool(store),
        createTagTool(store),
        createRemindTool(),
        createRecommendTool(db, store.baseDir),
    ];
    // FeedbackTracker-powered tool (L4 learning)
    if (feedbackTracker) {
        try {
            tools.push(createOptimizeTool(feedbackTracker));
        }
        catch { /* best effort */ }
    }
    // ── 优化4: 根据能力动态注册工具描述 ──
    const hasEmbedding = !!embedding;

    // Graph tool (knowledge graph)
    try {
        tools.push(createGraphTool(db, store.baseDir));
    }
    catch { /* best effort */ }
    // Enhanced search tool (vector rerank + keyword highlight)
    if (hasEmbedding) {
        try {
            tools.push(createEnhancedSearchTool(db, embedding));
        }
        catch { /* best effort */ }
    }
    else {
        try {
            tools.push(createEnhancedSearchTool(db));
        }
        catch { /* best effort */ }
    }
    // Retain tool (memory enhancement / anti-forgetting, best-effort)
    try {
        tools.push(createRetainTool(store, db));
    }
    catch { /* best effort */ }

    // Trends analysis tool (best-effort)
    try {
        tools.push(createTrendsTool(store));
    }
    catch { /* best effort */ }
    // Quality assessment tool (best-effort)
    try {
        tools.push(createQualityTool(store, db));
    }
    catch { /* best effort */ }
    // Cloud sync tool (best-effort, graceful when no credentials configured)
    try {
        tools.push(createCloudSyncTool(store));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${e.message}`);
    }
    // Unified memory management (all OpenClaw backends)
    try {
        tools.push(createUnifyTool(store));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${e.message}`);
    }
    // Import OpenClaw native chunks into Yaoyao index
    try {
        tools.push(createImportOCTool(store, db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Import OC tool skipped: ${e.message}`);
    }
    // Import workspace markdown files into Yaoyao index
    try {
        tools.push(createImportWorkspaceTool(store, db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Import workspace tool skipped: ${e.message}`);
    }
    // Insights extraction tool
    try {
        tools.push(createInsightsTool(db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Insights tool skipped: ${e.message}`);
    }
    // Diff comparison tool
    try {
        tools.push(createDiffTool(db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Diff tool skipped: ${e.message}`);
    }
    // Action suggestion tool
    try {
        tools.push(createSuggestTool(db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Suggest tool skipped: ${e.message}`);
    }
    // Archive management tool
    try {
        tools.push(createArchiveTool(db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Archive tool skipped: ${e.message}`);
    }
    // Conversation summary tool
    try {
        tools.push(createSummarizeTool(db, store));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Summarize tool skipped: ${e.message}`);
    }
    // Smart query tool
    try {
        tools.push(createSmartQueryTool(db));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Smart query tool skipped: ${e.message}`);
    }
    api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);
    return tools.length;
}
