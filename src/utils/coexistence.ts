/**
 * utils/coexistence.ts — Coexistence mode detection and monitoring.
 *
 * Detects whether another memory system (claw-core) is active and adjusts
 * yaoyao's behavior accordingly. Detection is config + filesystem based,
 * not tied to any specific platform variant.
 *
 * v1.7.9+: XiaoYi-specific detection removed. Uses generic signals:
 *   1. openclaw.json slots.memory ownership
 *   2. UDS socket file presence
 *   3. Shared memory segment presence
 *
 * v1.8.0: Added gspd_memory + core_skills detection for XiaoYi environments.
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
let _startedAt: number = Date.now();
let _changeHandlers: Array<(prev: CoexistState, next: CoexistState) => void> = [];

function _isInStartupGrace(): boolean {
  return Date.now() - _startedAt < STARTUP_GRACE_MS;
}

/** Read openclaw.json to check if memory slot is owned by another system. */
function _checkConfigSlotOwner(): boolean {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(configPath)) return false;
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const slots = config.slots as Record<string, string> | undefined;
    if (slots?.memory && slots.memory !== "yaoyao-memory") {
      return true;
    }
    // Check extensions/plugins for claw-core or gspd_memory (v1.8.0)
    const plugins = config.plugins as Record<string, unknown> | undefined;
    const entries = plugins?.entries as Record<string, Record<string, unknown>> | undefined;
    if (entries) {
      for (const val of Object.values(entries)) {
        const name = (val?.name as string || '').toLowerCase();
        if (name.includes("claw-core") || name.includes("memory-core") || name.includes("gspd_memory") || name.includes("gspd-memory")) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
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

/** v1.8.0: Check for core_skills directory (XiaoYi claw-core strong signal) */
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
  // Check config-based ownership
  if (_checkConfigSlotOwner()) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
    };
  }

  // Check for UDS socket / shared memory
  if (_checkUdsSocket()) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
    };
  }

  // v1.8.0: Check for core_skills (XiaoYi claw-core signal)
  if (_checkCoreSkills()) {
    return {
      mode: 'coexist',
      timestamp: Date.now(),
      gatewayVersion: '',
      gatewayAlive: true,
    };
  }

  // Default to standalone
  return {
    mode: 'standalone',
    timestamp: Date.now(),
    gatewayVersion: '',
    gatewayAlive: false,
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
  };

  if (!_isInStartupGrace()) {
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

export function startCoexistenceMonitor(intervalMs: number): () => void {
  const timer = setInterval(() => {
    if (_isInStartupGrace()) return;
    const current = detectCoexistence();
    if (current.mode !== _currentMode) {
      setCoexistMode(current.mode);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function onCoexistChange(
  handler: (prev: CoexistState, next: CoexistState) => void,
): void {
  _changeHandlers.push(handler);
}