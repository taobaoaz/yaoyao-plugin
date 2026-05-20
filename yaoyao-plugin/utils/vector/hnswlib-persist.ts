/**
 * utils/vector/hnswlib-persist.ts — HNSW index persistence helpers.
 */
import fs from "node:fs";
import type { HnswIndex, HnswMeta } from "./hnswlib-types.ts";

export interface PersistContext {
  index: HnswIndex | null;
  indexPath: string;
  metaPath: string;
  dimensions: number;
  config: { embedding?: { model?: string } };
  logger?: { debug?: (s: string) => void; warn?: (s: string) => void };
}

export function createPersistManager(ctx: PersistContext): PersistManager {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), 2000);
  }

  function flush(sync = false): void {
    if (!dirty || !ctx.index) return;
    dirty = false;
    try {
      if (sync) {
        ctx.index.writeIndexSync(ctx.indexPath);
      }
      const meta: HnswMeta = {
        dimensions: ctx.dimensions,
        model: ctx.config.embedding?.model,
        count: ctx.index.getCurrentCount?.() ?? 0,
        space: "cosine",
      };
      fs.writeFileSync(ctx.metaPath, JSON.stringify(meta, null, 2), "utf-8");
      ctx.logger?.debug?.("[yaoyao-memory:vec] HNSW index flushed to disk");
    } catch (err: unknown) {
      ctx.logger?.warn?.(`[yaoyao-memory:vec] flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function markDirty(): void {
    dirty = true;
    scheduleFlush();
  }

  function cleanup(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  return { scheduleFlush, flush, markDirty, cleanup };
}
