/**
 * utils/system-strategy.ts — Strategy recommendation based on system architecture.
 *
 * Zero external deps.
 */

import type { SystemArchitectureState } from "./system-config-reader.ts";

export interface StrategyRecommendation {
  captureMode: "full" | "l0-only" | "disabled";
  recallMode: "primary" | "supplement" | "disabled";
  shouldRegisterHooks: boolean;
  reason: string;
}

/** Recommend yaoyao strategy based on system architecture. */
export function getRecommendedStrategy(state: SystemArchitectureState): StrategyRecommendation {
  if (!state.isXiaoYiClaw) {
    return {
      captureMode: "full",
      recallMode: "primary",
      shouldRegisterHooks: true,
      reason: "Standard OpenClaw system — yaoyao full stack active",
    };
  }

  if (state.memorySlotOwner === "claw-core" && state.clawCoreEnabled) {
    return {
      captureMode: "l0-only",
      recallMode: "supplement",
      shouldRegisterHooks: true,
      reason: "XiaoYi Claw system (claw-core owns memory slot) — yaoyao L0 + supplement recall",
    };
  }

  if (state.hasCompetingMemoryPlugin) {
    return {
      captureMode: "l0-only",
      recallMode: "supplement",
      shouldRegisterHooks: true,
      reason: `Competing memory plugin detected (${state.memorySlotOwner}) — yaoyao L0 + supplement`,
    };
  }

  if (state.memorySlotOwner === "none") {
    return {
      captureMode: "full",
      recallMode: "primary",
      shouldRegisterHooks: true,
      reason: "Memory slot disabled system-wide — yaoyao filling the gap",
    };
  }

  return {
    captureMode: "full",
    recallMode: "primary",
    shouldRegisterHooks: true,
    reason: "claw-core present but not owning memory slot — yaoyao full stack with coexist bridge",
  };
}
