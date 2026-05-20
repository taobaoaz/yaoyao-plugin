/**
 * utils/coexistence.ts — Detect xiaoyiclaw claw-core presence.
 *
 * When claw-core is detected, yaoyao enters coexistence mode:
 * - L0 (daily log) still written by yaoyao
 * - L1/L2/FTS5/vector indexing skipped (claw-core handles heavy lifting)
 * - auto-recall delegates to claw_recall tool, then supplements with yaoyao results
 */
import { existsSync } from "node:fs";
import path from "node:path";

export type CoexistMode = "standalone" | "coexist";

export interface CoexistState {
  hasClawCore: boolean;
  hasClawWorker: boolean;
  udsPath: string;
  mode: CoexistMode;
}

let _coexistMode: CoexistMode = "standalone";

/** Global query — used by hooks to know current mode. */
export function getCoexistMode(): CoexistMode {
  return _coexistMode;
}

/** Called by entry/index.ts at bootstrap time. */
export function setCoexistMode(mode: CoexistMode): void {
  _coexistMode = mode;
}

/** Detect whether xiaoyiclaw claw-core is installed / running. */
export function detectCoexistence(homeDir?: string): CoexistState {
  const home = homeDir || process.env.HOME || "/home/sandbox";
  const udsPath = path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
  const hasUds = existsSync(udsPath);

  const extDir = path.join(home, ".openclaw/extensions/claw-core");
  const hasExt = existsSync(extDir);

  return {
    hasClawCore: hasExt,
    hasClawWorker: hasUds,
    udsPath,
    mode: hasUds ? "coexist" : "standalone",
  };
}

/** Runtime re-check (e.g. after claw-core starts post-yaoyao). */
export function refreshCoexistence(state: CoexistState): CoexistState {
  if (state.mode === "coexist") return state;
  const home = process.env.HOME || "/home/sandbox";
  const udsPath = path.join(home, ".openclaw/extensions/claw-core/var/claw-worker.sock");
  if (existsSync(udsPath)) {
    return { ...state, hasClawWorker: true, mode: "coexist" };
  }
  return state;
}
