/**
 * features/setup/collector.ts — gather DetectInput from the live environment.
 *
 * Bridges the pure detector with runtime state (coexistence, config, store,
 * capability report). Used by both the memory_setup tool and the first-run
 * guidance hook so they share one source of truth.
 */

import type { DetectInput } from "./detector.ts";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { CapabilityReport } from "../../utils/install-check.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";
import { getCoexistMode, getSlotOwner } from "../../utils/coexistence.ts";

/**
 * Assemble the detector input from current runtime state.
 * `memoryCount` is fetched cheaply; pass -1 if unavailable.
 */
export function collectSetupInput(
  config: YaoyaoMemoryConfig,
  cap: CapabilityReport,
  memoryDir: string,
  memoryCount: number,
): DetectInput {
  const celiaBridge = (config as unknown as Record<string, unknown>).celiaBridge as
    | { enabled?: boolean; mode?: string }
    | undefined;

  return {
    coexistMode: getCoexistMode(),
    slotOwner: getSlotOwner(),
    celiaBridge,
    embeddingEnabled: config.embedding?.enabled === true,
    llmEnabled: config.llm?.enabled !== false,
    cap,
    memoryDir,
    memoryCount,
  };
}

/**
 * Best-effort memory count. Returns 0 for empty/unknown rather than throwing.
 * Uses the store's list/count if available, else falls back to 0.
 */
export function safeMemoryCount(store: MemoryStore): number {
  try {
    // Prefer a dedicated count if the store exposes one.
    const anyStore = store as unknown as {
      count?: () => number;
      list?: (opts: { limit: number }) => unknown[];
    };
    if (typeof anyStore.count === "function") return anyStore.count();
    if (typeof anyStore.list === "function") {
      const rows = anyStore.list({ limit: 1 });
      return Array.isArray(rows) && rows.length > 0 ? 1 : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}
