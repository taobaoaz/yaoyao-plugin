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

export function registerMemoryTools(api: OpenClawPluginApi, store: MemoryStore, db: DBBridge) {
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
  ];

  for (const tool of tools) {
    api.registerTool(tool);
  }

  api.logger.info(`[yaoyao-memory] ${tools.length} tools registered (FTS5 + mood + timeline + backup)`);
}
