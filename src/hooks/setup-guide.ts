/**
 * hooks/setup-guide.ts — first-conversation auto-guidance hook.
 *
 * v1.9.1: On the very first conversation turn (per guidance-signature), inject
 * a concise setup hint into the prompt so the agent learns yaoyao's state and
 * can relay actionable next-steps to the user. After surfacing once, it stays
 * silent until the config materially changes (signature drift).
 *
 * Why this is separate from auto-recall/heartbeat:
 *   Those hooks are disabled in coexist mode to avoid conflicting with the
 *   slot owner. First-run guidance is higher priority and must fire regardless
 *   of mode, so it registers its own before_prompt_build listener and is not
 *   gated by capture/recall/heartbeat config flags.
 *
 * Non-repeating guarantee: a marker file (state.ts) records the signature we
 * last guided on. Any FS error degrades to "not shown" (re-guides), never to
 * "blocked".
 */

import type { OpenClawPluginApi } from "../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { MemoryStore } from "../utils/memory-store.ts";
import { runInstallCheck } from "../utils/install-check.ts";
import { collectSetupInput, safeMemoryCount } from "../features/setup/collector.ts";
import { detectSetup } from "../features/setup/detector.ts";
import { renderSetupPrompt } from "../features/setup/guide.ts";
import {
  computeGuidanceSignature,
  isGuidanceShown,
  markGuidanceShown,
} from "../features/setup/state.ts";
import { readPluginVersion } from "../entry/version.ts";

/**
 * Register the first-run guidance hook. Idempotent and failure-safe.
 * Returns immediately if the event is unavailable (older OpenClaw).
 */
export function registerSetupGuideHook(
  api: OpenClawPluginApi,
  config: YaoyaoMemoryConfig,
  store: MemoryStore,
): void {
  const version = readPluginVersion();
  // Probe once at registration to compute the signature. Cheap & idempotent.
  const cap = runInstallCheck();
  const memoryCount = safeMemoryCount(store);
  const input = collectSetupInput(config, cap, store.baseDir, memoryCount);
  const signature = computeGuidanceSignature({
    mode: input.coexistMode === "coexist" ? "coexist" : "standalone",
    slotOwner: input.slotOwner,
    bridgeEnabled: input.celiaBridge?.enabled === true,
    bridgeMode: input.celiaBridge?.mode ?? "",
    embeddingEnabled: input.embeddingEnabled,
    memoryEmpty: memoryCount === 0,
  });

  // Already guided for this exact config state → stay silent.
  if (isGuidanceShown(store.baseDir, signature, version)) {
    api.logger.debug?.("[yaoyao-memory:setup] guidance already shown for current config; skipping");
    return;
  }

  try {
    api.on("before_prompt_build", () => {
      // Re-check at fire time (marker may have been written by a parallel
      // plugin instance). If config is fully ready, still stay silent.
      if (isGuidanceShown(store.baseDir, signature, version)) return null;

      const state = detectSetup(input);
      if (state.ready) {
        // Nothing to guide on — mark shown so we don't re-probe every turn.
        markGuidanceShown(store.baseDir, signature, version);
        return null;
      }

      const prompt = renderSetupPrompt(state);
      if (!prompt) return null;

      // Mark shown immediately so a long first turn doesn't double-inject.
      markGuidanceShown(store.baseDir, signature, version);
      api.logger.info?.("[yaoyao-memory:setup] first-run guidance injected");
      // Prepend so the agent sees it prominently.
      return { prependContext: prompt };
    });
    api.logger.debug?.("[yaoyao-memory:setup] first-run guidance hook registered");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    api.logger.warn?.(`[yaoyao-memory:setup] guidance hook unavailable: ${msg}`);
  }
}
