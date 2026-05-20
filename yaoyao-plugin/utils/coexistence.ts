/**
 * utils/coexistence.ts — Detect xiaoyiclaw claw-core presence with runtime refresh.
 *
 * v2 improvements:
 *   - Periodic auto-refresh (detects claw-core starting/stopping post-yaoyao)
 *   - Environment-variable override (force mode for testing/emergencies)
 *   - Feature-level toggles (selective delegation instead of all-or-nothing)
 *   - Event-emitting state changes (hooks can react to transitions)
 *
 * When claw-core is detected, yaoyao enters coexistence mode:
 * - L0 (daily log) still written by yaoyao
 * - L1/L2/FTS5/vector indexing skipped (claw-core handles heavy lifting)
 * - auto-recall delegates to claw_recall tool, then supplements with yaoyao results
 */
import { existsSync } from "node:fs";
import path from "node:path";

export type CoexistMode = "standalone" | "coexist" | "disabled";

export interface CoexistFeatureFlags {
  /** Skip local L1/L2 indexing (FTS5 + vector) */
  skipLocalIndexing: boolean;
  /** Use claw-core as primary recall source */
  useClawPrimaryRecall: boolean;
  /** Forward capture events to claw-core (async fire-and-forget) */
  forwardCaptureToClaw: boolean;
}

export interface CoexistState {
  hasClawCore: boolean;
  hasClawWorker: boolean;
  udsPath: string;
  mode: CoexistMode;
  flags: CoexistFeatureFlags;
  lastCheckedAt: number;
  checkCount: number;
}

let _state: CoexistState = {
  hasClawCore: false,
  hasClawWorker: false,
  udsPath: "",
  mode: "standalone",
  flags: {
    skipLocalIndexing: false,
    useClawPrimaryRecall: false,
    forwardCaptureToClaw: false,
  },
  lastCheckedAt: 0,
  checkCount: 0,
};

let _refreshTimer: ReturnType<typeof setInterval> | null = null;
let _listeners: Array<(prev: CoexistState, next: CoexistState) => void> = [];

/** Global query — used by hooks to know current mode. */
export function getCoexistState(): Readonly<CoexistState> {
  return Object.freeze({ ..._state });
}

/** Backward-compatible alias. */
export function getCoexistMode(): CoexistMode {
  return _state.mode;
}

/** Subscribe to state transitions. */
export function onCoexistChange(fn: (prev: CoexistState, next: CoexistState) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

function _deriveFlags(mode: CoexistMode): CoexistFeatureFlags {
  if (mode === "coexist") {
    return {
      skipLocalIndexing: true,
      useClawPrimaryRecall: true,
      forwardCaptureToClaw: true,
    };
  }
  if (mode === "disabled") {
    // Explicit override: behave like standalone even if claw-core is present
    return {
      skipLocalIndexing: false,
      useClawPrimaryRecall: false,
      forwardCaptureToClaw: false,
    };
  }
  return {
    skipLocalIndexing: false,
    useClawPrimaryRecall: false,
    forwardCaptureToClaw: false,
  };
}

function _setState(next: CoexistState) {
  const prev = _state;
  _state = next;
  if (prev.mode !== next.mode) {
    for (const fn of _listeners) {
      try { fn(prev, next); } catch {}
    }
  }
}

/** Detect whether xiaoyiclaw claw-core is installed / running. */
export function detectCoexistence(homeDir?: string): CoexistState {
  const home = homeDir || process.env.HOME || "/home/sandbox";
  const udsPath = path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
  const hasUds = existsSync(udsPath);

  const extDir = path.join(home, ".openclaw/extensions/claw-core");
  const hasExt = existsSync(extDir);

  // Environment-variable override (for testing or emergency manual control)
  const envMode = process.env.YAOYAO_COEXIST_MODE as CoexistMode | undefined;
  const effectiveMode: CoexistMode = envMode && ["standalone", "coexist", "disabled"].includes(envMode)
    ? envMode
    : hasUds ? "coexist" : "standalone";

  const next: CoexistState = {
    hasClawCore: hasExt,
    hasClawWorker: hasUds,
    udsPath,
    mode: effectiveMode,
    flags: _deriveFlags(effectiveMode),
    lastCheckedAt: Date.now(),
    checkCount: _state.checkCount + 1,
  };
  _setState(next);
  return next;
}

/** Runtime re-check (e.g. after claw-core starts post-yaoyao). */
export function refreshCoexistence(): CoexistState {
  return detectCoexistence();
}

/** Start periodic auto-refresh (default every 30s). Call once at plugin init. */
export function startCoexistenceMonitor(intervalMs = 30000): () => void {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
  _refreshTimer = setInterval(() => {
    refreshCoexistence();
  }, intervalMs).unref();

  // Return stop function
  return () => {
    if (_refreshTimer) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  };
}

/** Stop monitor (e.g. on plugin unload). */
export function stopCoexistenceMonitor(): void {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}
