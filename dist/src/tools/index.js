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
    // Graph tool (knowledge graph)
    try {
        tools.push(createGraphTool(db, store.baseDir));
    }
    catch { /* best effort */ }
    // Enhanced search tool (vector rerank + keyword highlight)
    if (embedding) {
        try {
            tools.push(createEnhancedSearchTool(db, embedding));
        }
        catch { /* best effort */ }
    }
    else {
        // FTS5-only enhanced search (no rerank, but still highlight)
        try {
            tools.push(createEnhancedSearchTool(db));
        }
        catch { /* best effort */ }
    }
    api.logger.info(`[yaoyao-memory] ${tools.length} tools registered (FTS5 + mood + timeline + backup)`);
}
