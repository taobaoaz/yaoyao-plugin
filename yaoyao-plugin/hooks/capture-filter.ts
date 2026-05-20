/**
 * hooks/capture-filter.ts — Session filtering and capture decision engine.
 *
 * Extracted from auto-capture.ts. Handles:
 *   - Session label filtering
 *   - Agent exclusion (glob)
 *   - Warmup mode (1→2→4→8 trigger rounds)
 *   - Fixed-interval capture (every N turns)
 *   - Regex exclusion patterns
 *   - Session activity tracking
 *   - Conversation value estimation
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { getProp, getBool } from "../utils/config.ts";
import { clampNum } from "../utils/clamp.ts";
import { createSessionFilter } from "../utils/session-filter.ts";
import { isExcludedAgent } from "../utils/glob-match.ts";
import { recordSessionActivity, isSessionActive, pruneStaleSessions } from "../utils/session-activity.ts";

export interface CaptureDecision {
  /** Should the capture proceed? */
  shouldCapture: boolean;
  /** Reason for skipping (empty if shouldCapture is true) */
  skipReason?: string;
}

export interface CaptureContext {
  sessionKey: string;
  messages: Array<Record<string, unknown>>;
  agentId?: string;
}

/**
 * Check if a capture should proceed based on session-level filters.
 * Returns { shouldCapture: true } or { shouldCapture: false, skipReason }.
 */
export function shouldCaptureTurn(
  ctx: CaptureContext,
  config: YaoyaoMemoryConfig,
): CaptureDecision {
  const { sessionKey, messages, agentId } = ctx;

  // Session filter: skip internal/system sessions
  const sessionFilter = createSessionFilter({
    blockLabels: config.blockLabels || [],
    blockInternal: true,
    minMessages: 1,
  });
  if (!sessionFilter.shouldProcess(sessionKey)) {
    return { shouldCapture: false, skipReason: `Session ${sessionKey} was blocked by session filter` };
  }

  // Agent exclusion
  const excludeAgents = getProp(config, "capture.excludeAgents", []) as string[];
  if (agentId && excludeAgents.length > 0 && isExcludedAgent(agentId, excludeAgents)) {
    return { shouldCapture: false, skipReason: `Excluded agent: ${agentId}` };
  }

  // Warmup mode: 1→2→4→8...
  const enableWarmup = getBool(config, "capture.enableWarmup", false);
  if (enableWarmup) {
    const roundCount = messages.filter((m: Record<string, unknown>) => m.role === "user").length;
    const nextTrigger = Math.pow(2, Math.floor(Math.log2(Math.max(1, roundCount))));
    if (roundCount !== nextTrigger && roundCount !== 1) {
      return { shouldCapture: false, skipReason: `Warmup skip: round ${roundCount}, next trigger at ${nextTrigger}` };
    }
  }

  // Fixed-interval capture
  const everyN = clampNum(getProp(config, "capture.everyNConversations", 0), 0, 0, 100);
  if (everyN > 0 && !enableWarmup) {
    const roundCount = messages.filter((m: Record<string, unknown>) => m.role === "user").length;
    if (roundCount % everyN !== 0) {
      return { shouldCapture: false, skipReason: `Every-N skip: round ${roundCount}, trigger every ${everyN}` };
    }
  }

  // Regex exclusion patterns
  const excludePatterns = (getProp(config, "capture.excludePatterns", []) as string[])
    .map(p => { try { return new RegExp(p, "i"); } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:capture] Invalid pattern "${p}": ${msg}`);
      return null;
    } })
    .filter((r): r is RegExp => r !== null);
  if (excludePatterns.length > 0) {
    const fullText = messages.map((m: Record<string, unknown>) => (m.content || m.text || "")).join(" ");
    for (const pattern of excludePatterns) {
      if (pattern.test(fullText)) {
        return { shouldCapture: false, skipReason: `Excluded pattern: ${pattern.source}` };
      }
    }
  }

  return { shouldCapture: true };
}

/**
 * Track session activity and prune stale sessions.
 * Returns session activity info.
 */
export function trackSessionActivity(
  sessionKey: string,
  config: YaoyaoMemoryConfig,
): {
  wasActive: boolean;
  turnCount: number;
  shouldLogResume: boolean;
} {
  const activeWindowHours = clampNum(getProp(config, "capture.sessionActiveWindowHours", 24), 24, 1, 168);

  const sessionActivity = recordSessionActivity(sessionKey);
  const wasActive = isSessionActive(sessionKey, activeWindowHours);
  const shouldLogResume = !wasActive && sessionActivity.turnCount > 1;

  // Prune stale sessions periodically
  if (sessionActivity.turnCount % 50 === 0) {
    pruneStaleSessions(activeWindowHours);
  }

  return { wasActive, turnCount: sessionActivity.turnCount, shouldLogResume };
}
