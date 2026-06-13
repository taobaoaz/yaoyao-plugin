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
 */

import { existsSync, readdirSync } from "node:fs";
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
    const raw = require("node:fs").readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const slots = config.slots as Record<string, string> | undefined;
    if (slots?.memory && slots.memory !== "yaoyao-memory") {
      return true;
    }
    // Check extensions directory for claw-core
    const plugins = config.plugins as Record<string, unknown> | undefined;
    const entries = plugins?.entries as Record<string, Record<string, unknown>> | undefined;
    if (entries) {
      for (const val of Object.values(entries)) {
        const name = (val?.name as string || '').toLowerCase();
        if (name.includes("claw-core") || name.includes("memory-core")) {
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
    }
  } catch {
    // ignore
  }
  return false;
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