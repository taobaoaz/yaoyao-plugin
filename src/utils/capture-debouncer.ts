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
 *    it replaces the pending request (latest content wins)
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

  /** Schedule the next debounced flush */
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(doFlush, cfg.debounceMs);
    flushTimer.unref?.();
  }

  /** Force flush timer (max delay guarantee) */
  function ensureForceTimer() {
    if (forceTimer) return;
    forceTimer = setTimeout(() => {
      doFlush();
    }, cfg.maxDelayMs);
    forceTimer.unref?.();
  }

  /** Actually flush pending items */
  function doFlush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (forceTimer) { clearTimeout(forceTimer); forceTimer = null; }

    if (pending.size === 0) return;

    const batch = Array.from(pending.values()).map(({ _firstAt, _lastAt, ...item }) => item);
    pending.clear();
    flushedCount += batch.length;

    try {
      flushHandler(batch);
    } catch (err) {
      console.error?.(`[capture-debouncer] Flush error: ${(err as Error).message}`);
    }
  }

  return {
    /**
     * Submit a capture for debounced processing.
     * If the same sessionKey already has a pending item, the new
     * content replaces it (latest wins, mergedCount increments).
     */
    push(item: {
      sessionKey: string;
      userContent: string;
      asstContent: string;
      date: string;
      timestamp: string;
      meta?: string;
    }): void {
      const existing = pending.get(item.sessionKey);
      if (existing) {
        // Merge: update content, increment counter
        existing.userContent = item.userContent;
        existing.asstContent = item.asstContent;
        existing.date = item.date;
        existing.timestamp = item.timestamp;
        existing.meta = item.meta;
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
     * Useful during shutdown or when immediate persistence is needed.
     */
    flushNow(): void {
      doFlush();
    },

    /** Drain & stop all timers */
    destroy(): void {
      doFlush();
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
