/**
 * Tool index — registers all yaoyao-memory tools.
 * Each tool is defined in its own file under src/tools/.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";

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
import { createCloudSyncTool } from "./cloud-sync.js";
import { createUnifyTool } from "./memory-unify.js";
import { createTrendsTool } from "./memory-trends.js";
import { createQualityTool } from "./memory-quality.js";
import { createRetainTool } from "./memory-retain.js";
import type { FeedbackTracker } from "../learning/feedback-tracker.js";
import type { EmbeddingService } from "../utils/embedding.js";
import type { PersonaStateMachine } from "../utils/persona-state.js";

import { createDistillTool } from "./memory-distill.js";

export function registerMemoryTools(api: OpenClawPluginApi, store: MemoryStore, db: DBBridge, feedbackTracker?: FeedbackTracker | null, embedding?: EmbeddingService | null, personaState?: PersonaStateMachine | null) {
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
    // v3: Distill implicit observations into persona.md (silent, not real-time)
    ...(personaState ? [createDistillTool(personaState, store.baseDir)] : []),
  ];

  // FeedbackTracker-powered tool (L4 learning)
  if (feedbackTracker) {
    try {
      tools.push(createOptimizeTool(feedbackTracker));
    } catch { /* best effort */ }
  }

  // Graph tool (knowledge graph)
  try {
    tools.push(createGraphTool(db, store.baseDir));
  } catch { /* best effort */ }

  // Enhanced search tool (vector rerank + keyword highlight)
  if (embedding) {
    try {
      tools.push(createEnhancedSearchTool(db, embedding));
    } catch { /* best effort */ }
  } else {
    // FTS5-only enhanced search (no rerank, but still highlight)
    try {
      tools.push(createEnhancedSearchTool(db));
    } catch { /* best effort */ }
  }

  // Retain tool (memory enhancement / anti-forgetting, best-effort)
  try {
    tools.push(createRetainTool(store, db));
  } catch { /* best effort */ }

  // Quality assessment tool (best-effort)
  try {
    tools.push(createQualityTool(store, db));
  } catch { /* best effort */ }

  // Trends analysis tool (best-effort)
  try {
    tools.push(createTrendsTool(store));
  } catch { /* best effort */ }

  // Cloud sync tool (best-effort, graceful when no credentials configured)
  try {
    tools.push(createCloudSyncTool(store));
  } catch (e: any) {
    api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${e.message}`);
  }
  // Unified memory management (all OpenClaw backends)
  try {
    tools.push(createUnifyTool(store));
  } catch (e: any) {
    api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${e.message}`);
  }
  api.logger.info(`[yaoyao-memory] ${tools.length} tools registered`);
  return tools.length;
}
