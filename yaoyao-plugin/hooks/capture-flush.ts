/**
 * hooks/capture-flush.ts — Debouncer flush handler for L0/L1/L2 writes.
 *
 * Decides: local queue (async) → claw-core forward (coexist) → sync fallback.
 * Pure factory, no orchestration logic.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ClawBridge } from "../utils/claw-bridge.ts";
import type { PersistHandlers } from "./persist-handlers.ts";
import type { createWriteQueue } from "../utils/write-queue.ts";

type WriteQueue = ReturnType<typeof createWriteQueue>;

export interface FlushBatchItem {
  sessionKey: string;
  userContent: string;
  asstContent: string;
  date: string;
  timestamp: string;
  meta?: string;
  entry: string;
}

/** Build the flush callback handed to capture-debouncer. */
export function createFlushHandler(
  persist: PersistHandlers,
  writeQueue: WriteQueue | null,
  clawBridge: ClawBridge | null,
  forwardCapture: boolean,
  api: OpenClawPluginApi,
): (batch: FlushBatchItem[]) => Promise<void> {
  return async (batch) => {
    // L0 markdown — synchronous safety net
    for (const item of batch) {
      try {
        persist.writeDailyEntry(item.date, item.entry);
      } catch (e: unknown) {
        api.logger.error?.(
          `[yaoyao-memory:flush] L0 write failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // L1+L2 — async queue (standalone)
    if (writeQueue) {
      for (const item of batch) {
        writeQueue.enqueue({
          date: item.date,
          timestamp: item.timestamp,
          userContent: item.userContent,
          asstContent: item.asstContent,
          meta: item.meta,
        });
      }
      return;
    }

    // L1+L2 — forward to claw-core (coexist mode)
    if (forwardCapture && clawBridge) {
      const items = batch.map((item) => ({
        userContent: item.userContent,
        asstContent: item.asstContent,
        date: item.date,
        timestamp: item.timestamp,
        meta: item.meta,
        source: "yaoyao-proxy",
      }));
      clawBridge.call("store_batch", { items }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.debug?.(`[yaoyao-memory:flush] claw-core forward failed: ${msg}`);
        // Fallback: write locally
        persist.flushBatch(
          items.map((i) => ({
            userContent: i.userContent,
            asstContent: i.asstContent,
            date: i.date,
            meta: i.meta,
          })),
        ).catch(() => {});
      });
      return;
    }

    // L1+L2 — sync fallback (standalone without queue)
    await persist.flushBatch(
      batch.map((item) => ({
        userContent: item.userContent,
        asstContent: item.asstContent,
        date: item.date,
        meta: item.meta,
      })),
    );
  };
}
