/**
 * utils/coexistence.ts — Coexistence mode detection and monitoring.
 *
 * Detects whether another memory system (claw-core) is active and adjusts
 * yaoyao's behavior accordingly. Detection is config + filesystem based,
 * not tied to any specific platform variant.
 *
 * History:
 *   v1.7.9: Stripped the XiaoYi-specific adapter (entry/xiaoyi-adapter.ts)
 *            and XiaoYi-flavored detection branches. Detection is now
 *            platform-agnostic.
 *   v1.8.0: Added generic claw-core coexistence signals (gspd_memory
 *            plugin presence, core_skills/ directory with claw-core
 *            skills). These happen to fire on XiaoYi environments but
 *            are not XiaoYi-specific — they detect any claw-core.
 *   v1.9.1: Added memory-celia (华为小艺 Claw 官方记忆插件) recognition.
 *            slotOwner is now propagated so callers can tell *which*
 *            system owns the memory slot and adapt (e.g. celia bridge).
 *
 * Active generic signals:
 *   1. openclaw.json slots.memory ownership
 *   2. openclaw.json plugins.entries (claw-core / gspd_memory)
 *   3. UDS socket file presence
 *   4. core_skills/ directory with claw-core skills
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type CoexistMode = 'coexist' | 'standalone' | 'unknown';

export interface CoexistState {
  mode: CoexistMode;
  timestamp: number;
  gatewayVersion: string;
  gatewayAlive: boolean;
  /**
   * v1.9.1: The concrete plugin id that owns the memory slot
   * (e.g. "memory-celia", "claw-core"), if known. Empty when the slot
   * is free or the owner cannot be determined. Used by the celia bridge
   * to decide whether to activate delegation.
   */
  slotOwner?: string;
}

/** Startup grace period before coexistence detection activates (ms). */
const STARTUP_GRACE_MS = 600;

let _currentMode: CoexistMode = 'unknown';
let _currentState: CoexistState = {
  mode: 'unknown',
  timestamp: Date.now(),
  gatewayVersion: '',
  gatewayAlive: false,
};

// v1.8.0-fix: Do immediate detection on module load (bypass grace period)
// This ensures correct mode is available at startup, not after 600ms delay.
(function _initialDetect() {
  const initial = _doDetect();
  _currentMode = initial.mode;
  _currentState = initial;
})();
let _startedAt: number = Date.now();
let _changeHandlers: Array<(prev: CoexistState, next: CoexistState) => void> = [];

function _isInStartupGrace(): boolean {
  return Date.now() - _startedAt < STARTUP_GRACE_MS;
}

/**
 * Read openclaw.json to check if memory slot is owned by another system.
 * v1.9.1: Returns the owner id (e.g. "memory-celia") instead of a boolean,
 * so callers can adapt to the *specific* owner. Empty string = unowned / free.
 */
function _checkConfigSlotOwner(): string {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(configPath)) return "";
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const slots = config.slots as Record<string, string> | undefined;
    if (slots?.memory && slots.memory !== "yaoyao-memory") {
      return slots.memory;
    }
    // Check extensions/plugins for claw-core or gspd_memory (v1.8.0)
    const plugins = config.plugins as Record<string, unknown> | undefined;
    const entries = plugins?.entries as Record<string, Record<string, unknown>> | undefined;
    if (entries) {
      for (const val of Object.values(entries)) {
        const name = (val?.name as string || '').toLowerCase();
        if (name.includes("claw-core") || name.includes("memory-core") || name.includes("gspd_memory") || name.includes("gspd-memory")) {
          // Surface the raw entry name as the owner
          return (val?.name as string) || name;
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Check for UDS socket files indicating claw-core worker is running. */
function _checkUdsSocket(): boolean {
  // Linux/macOS: /tmp
  const tmpDir = "/tmp";
  if (existsSync(tmpDir)) {
    try {
      const entries = readdirSync(tmpDir);
      if (entries.some(e => (e.includes("claw-worker") || e.includes("claw_core")) && e.endsWith(".sock"))) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  // Windows / cross-platform: extensions directory
  try {
    const extDir = join(homedir(), ".openclaw", "extensions");
    if (existsSync(extDir)) {
      const entries = readdirSync(extDir);
      if (entries.includes("claw-core")) {
        const varDir = join(extDir, "claw-core", "var");
        if (existsSync(varDir)) return true;
      }
      // v1.8.0: gspd_memory plugin presence
      if (entries.includes("gspd_memory") || entries.includes("gspd-memory")) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/** v1.8.0: Check for core_skills directory (generic claw-core signal) */
function _checkCoreSkills(): boolean {
  try {
    const possibleRoots = [
      process.env.OPENCLAW_HOME,
      homedir(),
    ].filter(Boolean) as string[];
    for (const root of possibleRoots) {
      const coreSkillsDir = join(root, ".openclaw", "core_skills");
      if (existsSync(coreSkillsDir)) {
        const entries = readdirSync(coreSkillsDir);
        // core_skills with at least one known claw-core skill = strong signal
        if (entries.some(e =>
          e.includes("secret-guardian") || e.includes("execution-validator") || e.includes("skill-scope")
        )) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Actual detection: check if another claw core is running */
function _doDetect(): CoexistState {
  // Check config-based ownership (v1.9.1: returns owner id, "" = free)
  const slotOwner = _checkConfigSlotOwner();
  if (slotOwner) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
      slotOwner,
    };
  }

  // Check for UDS socket / shared memory
  if (_checkUdsSocket()) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
      slotOwner: 'claw-core',
    };
  }

  // v1.8.0: Check for core_skills (generic claw-core signal)
  if (_checkCoreSkills()) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
      slotOwner: 'claw-core',
    };
  }

  // Default to standalone
  return {
    mode: 'standalone',
    timestamp: Date.now(),
    gatewayVersion: '',
    gatewayAlive: false,
    slotOwner: '',
  };
}

export function detectCoexistence(): CoexistState {
  if (_isInStartupGrace()) {
    return _currentState;
  }
  return _doDetect();
}

export function setCoexistMode(mode: CoexistMode): void {
  const prev = { ..._currentState };
  _currentMode = mode;
  _currentState = {
    mode,
    timestamp: Date.now(),
    gatewayVersion: _currentState.gatewayVersion,
    gatewayAlive: _currentState.gatewayAlive,
    slotOwner: _currentState.slotOwner,
  };

  if (!_isInStartupGrace()) {
    for (const handler of _changeHandlers) {
      handler(prev, _currentState);
    }
  }
}

/**
 * v1.9.1: Apply a full CoexistState (mode + slotOwner) detected at runtime.
 * Triggers change handlers if either mode or slotOwner differs from current.
 */
export function applyCoexistState(next: CoexistState): void {
  const prev = { ..._currentState };
  const changed = prev.mode !== next.mode || (prev.slotOwner ?? '') !== (next.slotOwner ?? '');
  _currentMode = next.mode;
  _currentState = { ...next };
  if (changed && !_isInStartupGrace()) {
    for (const handler of _changeHandlers) {
      handler(prev, _currentState);
    }
  }
}

export function getCoexistMode(): CoexistMode {
  return _currentMode;
}

export function getCoexistState(): CoexistState {
  return { ..._currentState };
}

/**
 * v1.9.1: The plugin id currently owning the memory slot, if any.
 * Empty string when the slot is free (standalone mode) or unknown.
 */
export function getSlotOwner(): string {
  return _currentState.slotOwner ?? '';
}

/**
 * v1.9.1: True when the memory slot is owned by memory-celia
 * (华为小艺 Claw 官方记忆插件). Enables the celia delegation bridge.
 */
export function isCeliaActive(): boolean {
  const owner = getSlotOwner().toLowerCase();
  return owner.includes('celia');
}

export function startCoexistenceMonitor(intervalMs: number): () => void {
  const timer = setInterval(() => {
    if (_isInStartupGrace()) return;
    const current = detectCoexistence();
    // v1.9.1: also react to slotOwner changes (e.g. celia appeared/disappeared)
    if (current.mode !== _currentMode || (current.slotOwner ?? '') !== (getSlotOwner())) {
      applyCoexistState(current);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function onCoexistChange(
  handler: (prev: CoexistState, next: CoexistState) => void,
): void {
  _changeHandlers.push(handler);
}