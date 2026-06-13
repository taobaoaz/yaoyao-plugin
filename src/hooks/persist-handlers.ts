/**
 * hooks/persist-handlers.ts — Persistence layer handlers for auto-capture.
 *
 * Encapsulates L0 markdown + L1 FTS5 + L2 vector writes.
 * Pure factory, no orchestration logic.
 */

import type { OpenClawPluginApi } from "../openclaw-sdk/plugin-entry.ts";
import type { MemoryStore } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";

interface WriteResult {
  rowId: number;
  text: string;
  meta?: string;
}

export interface PersistHandlers {
  flushBatch: (tasks: Array<{ userContent: string; asstContent: string; date: string; meta?: string }>) => Promise<void>;
  writeDailyEntry: (date: string, entry: string) => void;
}

export function createPersistHandlers(
  api: OpenClawPluginApi,
  db: DBBridge,
  store: MemoryStore,
  embedding?: import("../utils/embedding.ts").EmbeddingService | null,
): PersistHandlers {
  return {
    flushBatch: async (tasks) => {
      const rows: WriteResult[] = [];
      for (const task of tasks) {
        try {
          const rowId = db.indexTurn(task.userContent, task.asstContent, task.date, task.meta);
          if (rowId > 0 && embedding) {
            rows.push({ rowId, text: `${task.userContent}\n${task.asstContent}`, meta: task.meta });
          }
        } catch (e2: unknown) {
          api.logger.error?.(`[yaoyao-memory:persist] indexTurn failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
        }
      }
      if (rows.length > 0 && embedding) {
        try {
          const vectors = await embedding.embedBatch(rows.map(r => r.text));
          for (let i = 0; i < rows.length; i++) {
            if (vectors && vectors[i]) db.storeVector(rows[i].rowId, vectors[i]);
          }
        } catch (e2: unknown) {
          api.logger.debug?.(`[yaoyao-memory:persist] Batch vector store failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
        }
      }
    },

    writeDailyEntry: (date, entry) => {
      store.appendToDaily(date, entry);
    },
  };
}
