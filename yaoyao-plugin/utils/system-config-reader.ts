/**
 * utils/system-config-reader.ts — Read OpenClaw global config to detect system architecture.
 *
 * When OpenClaw is configured with claw-core as the memory/contextEngine slot,
 * yaoyao must detect this at bootstrap and adjust its registration strategy.
 *
 * Zero external deps. Uses node:fs and node:path.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface OpenClawPluginsConfig {
  slots?: {
    memory?: string;
    contextEngine?: string;
  };
  entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
  allow?: string[];
  deny?: string[];
}

export interface OpenClawGlobalConfig {
  plugins?: OpenClawPluginsConfig;
  agents?: {
    defaults?: {
      memorySearch?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
      };
    };
  };
}

export interface SystemArchitectureState {
  /** Is this a XiaoYi Claw system (claw-core present + configured)? */
  isXiaoYiClaw: boolean;
  /** What plugin owns the memory slot */
  memorySlotOwner: string | 'default' | 'none';
  /** What plugin owns the contextEngine slot */
  contextEngineSlotOwner: string | 'default' | 'none';
  /** Is claw-core plugin enabled in entries */
  clawCoreEnabled: boolean;
  /** Is yaoyao-memory enabled in entries */
  yaoyaoEnabled: boolean;
  /** Is built-in memory-core enabled (via slot or allowlist) */
  memoryCoreEnabled: boolean;
  /** Does the system have another active memory plugin competing with yaoyao */
  hasCompetingMemoryPlugin: boolean;
  /** Detected OpenClaw version (from meta.lastTouchedVersion) */
  openClawVersion: string;
  /** Config file path that was read */
  configPath: string;
  /** Raw parsed config (for deep inspection) */
  raw: OpenClawGlobalConfig;
}

let _systemState: SystemArchitectureState | null = null;

/** Detect OpenClaw config file path. */
function findConfigPath(): string | null {
  const candidates = [
    process.env.OPENCLAW_CONFIG,
    path.join(process.env.OPENCLAW_WORKSPACE || '/root/.openclaw', 'openclaw.json'),
    path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json'),
    '/root/.openclaw/openclaw.json',
    '/home/sandbox/.openclaw/openclaw.json',
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Read and parse OpenClaw global config. */
function readOpenClawConfig(path: string): OpenClawGlobalConfig {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as OpenClawGlobalConfig;
  } catch {
    return {};
  }
}

/** Analyze system architecture from OpenClaw config. */
export function detectSystemArchitecture(): SystemArchitectureState {
  if (_systemState) return _systemState;

  const configPath = findConfigPath() || 'unknown';
  const cfg = configPath !== 'unknown' ? readOpenClawConfig(configPath) : {};

  const plugins = cfg.plugins || {};
  const slots = plugins.slots || {};
  const entries = plugins.entries || {};
  const allow = plugins.allow || [];

  const memorySlotOwner = slots.memory || 'default';
  const contextEngineSlotOwner = slots.contextEngine || 'default';

  const clawCoreEnabled = !!entries['claw-core']?.enabled;
  const yaoyaoEnabled = !!entries['yaoyao-memory']?.enabled;

  // memory-core is enabled by default (it's a bundled plugin)
  // It's active if: (1) allowlist includes it, (2) no denylist blocks it, (3) slot not set to "none"
  const memoryCoreEnabled = allow.includes('memory-core') || !plugins.allow;

  // Competing memory plugin detection:
  // If memory slot is owned by someone other than "default" (memory-core) or "none",
  // and that plugin is enabled, then yaoyao has competition.
  const competingPlugins = ['claw-core', 'memory-lancedb'];
  const hasCompetingMemoryPlugin =
    memorySlotOwner !== 'default' &&
    memorySlotOwner !== 'none' &&
    competingPlugins.includes(memorySlotOwner) &&
    !!entries[memorySlotOwner]?.enabled;

  // XiaoYi Claw system detection:
  // Either claw-core is explicitly enabled, OR memory slot is assigned to claw-core
  const isXiaoYiClaw = clawCoreEnabled || memorySlotOwner === 'claw-core';

  const version =
    (((cfg as Record<string, unknown>).meta as Record<string, unknown>)
      ?.lastTouchedVersion as string) || 'unknown';

  _systemState = {
    isXiaoYiClaw,
    memorySlotOwner,
    contextEngineSlotOwner,
    clawCoreEnabled,
    yaoyaoEnabled,
    memoryCoreEnabled,
    hasCompetingMemoryPlugin,
    openClawVersion: version,
    configPath,
    raw: cfg,
  };

  return _systemState;
}

/** Force re-detection (e.g. after config change). */
export function refreshSystemArchitecture(): SystemArchitectureState {
  _systemState = null;
  return detectSystemArchitecture();
}

/** Get cached state (lightweight, no file I/O). */
export function getSystemArchitecture(): SystemArchitectureState | null {
  return _systemState;
}

import { getRecommendedStrategy, type StrategyRecommendation } from './system-strategy.ts';
export { getRecommendedStrategy, type StrategyRecommendation } from './system-strategy.ts';
