/**
 * utils/capture-debouncer.ts — Capture debouncing queue.
 *
 * Batches redundant capture events within a time window to reduce
 * LLM calls and DB writes. Inspired by Cortex Memory's
 * LayerUpdateDebouncer pattern.
 *
 * How it works:
 * 1. Each capture request is recorded with a dedup key (session + content hash)
 * 2. If a new request arrives for the same session within debounceMs,
 *    content is appended (all turns preserved, not overwritten)
 * 3. After debounceMs of silence (or maxDelayMs), the request is flushed
 */

import { clampNum } from "./clamp.ts";

export interface DebouncedCapture {
  sessionKey: string;
  userContent: string;
  asstContent: string;
  date: string;
  timestamp: string;
  meta?: string;
  /** L0 markdown entry string */
  entry?: string;
  /** How many raw calls were merged into this one */
  mergedCount: number;
}

export interface CaptureDebouncerConfig {
  /** Quiet period before flush (ms) */
  debounceMs: number;
  /** Max delay before forced flush (ms) */
  maxDelayMs: number;
  /** Max items in queue before forced flush */
  maxQueueSize: number;
}

const DEFAULT_CONFIG: CaptureDebouncerConfig = {
  debounceMs: 3_000,
  maxDelayMs: 10_000,
  maxQueueSize: 50,
};

/**
 * Capture debouncer — merges rapid successive capture events.
 * thread-safe through single-threaded JS event loop.
 */
export function createCaptureDebouncer(
  config: Partial<CaptureDebouncerConfig> = {},
  flushHandler: (batch: DebouncedCapture[]) => void,
) {
  const cfg: CaptureDebouncerConfig = {
    debounceMs: clampNum(config.debounceMs ?? DEFAULT_CONFIG.debounceMs, 3_000, 500, 30_000),
    maxDelayMs: clampNum(config.maxDelayMs ?? DEFAULT_CONFIG.maxDelayMs, 10_000, 2_000, 60_000),
    maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
  };

  // Pending items keyed by sessionKey
  const pending = new Map<string, DebouncedCapture & { _firstAt: number; _lastAt: number }>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  let flushedCount = 0;
  let mergedCount = 0;
  let currentFlushPromise: Promise<void> | null = null;

  /** Schedule the next debounced flush */
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { doFlush(); }, cfg.debounceMs);
    flushTimer.unref?.();
  }

  /** Force flush timer (max delay guarantee) */
  function ensureForceTimer() {
    if (forceTimer) return;
    forceTimer = setTimeout(() => { doFlush(); }, cfg.maxDelayMs);
    forceTimer.unref?.();
  }

  /** Actually flush pending items */
  async function doFlush(): Promise<void> {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (forceTimer) { clearTimeout(forceTimer); forceTimer = null; }

    if (pending.size === 0) return;

    const batch = Array.from(pending.values()).map(({ _firstAt, _lastAt, ...item }) => item);
    pending.clear();
    flushedCount += batch.length;

    try {
      await flushHandler(batch);
    } catch (err) {
      console.error?.(`[capture-debouncer] Flush error: ${(err as Error).message}`);
    }
  }

  return {
    /**
     * Submit a capture for debounced processing.
     * If the same sessionKey already has a pending item, the new
     * content is appended (all turns preserved, mergedCount increments).
     */
    push(item: {
      sessionKey: string;
      userContent: string;
      asstContent: string;
      date: string;
      timestamp: string;
      meta?: string;
      entry?: string;
    }): void {
      const existing = pending.get(item.sessionKey);
      if (existing) {
        // Merge: append content (preserve all turns, don't overwrite)
        existing.userContent = existing.userContent + "\n---\n" + item.userContent;
        existing.asstContent = existing.asstContent + "\n---\n" + item.asstContent;
        existing.date = item.date;
        existing.timestamp = item.timestamp;
        existing.meta = item.meta;
        existing.entry = (existing.entry ?? "") + (item.entry ?? "");
        existing._lastAt = Date.now();
        existing.mergedCount++;
        mergedCount++;
      } else {
        pending.set(item.sessionKey, {
          ...item,
          mergedCount: 1,
          _firstAt: Date.now(),
          _lastAt: Date.now(),
        });
      }

      scheduleFlush();
      ensureForceTimer();

      // Safety valve: force flush if queue is too large
      if (pending.size >= cfg.maxQueueSize) {
        doFlush();
      }
    },

    /**
     * Force flush all pending items immediately.
     * Returns a promise that resolves when flush is complete.
     */
    flushNow(): Promise<void> {
      return doFlush();
    },

    /** Drain & stop all timers. Returns a promise that resolves when flush is complete. */
    async destroy(): Promise<void> {
      await doFlush();
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (forceTimer) { clearTimeout(forceTimer); forceTimer = null; }
    },

    /** Current queue depth */
    get size(): number { return pending.size; },

    /** Statistics for monitoring */
    stats(): { flushedCount: number; mergedCount: number; queueSize: number } {
      return { flushedCount, mergedCount, queueSize: pending.size };
    },
  };
}

export type CaptureDebouncer = ReturnType<typeof createCaptureDebouncer>;
