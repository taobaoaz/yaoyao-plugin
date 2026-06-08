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
let _systemState = null;
/** Detect OpenClaw config file path. */
function findConfigPath() {
    const candidates = [
        process.env.OPENCLAW_CONFIG,
        path.join(process.env.OPENCLAW_WORKSPACE || '/root/.openclaw', 'openclaw.json'),
        path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json'),
        '/root/.openclaw/openclaw.json',
        '/home/sandbox/.openclaw/openclaw.json',
    ];
    for (const p of candidates) {
        if (p && existsSync(p))
            return p;
    }
    return null;
}
/** Read and parse OpenClaw global config. */
function readOpenClawConfig(path) {
    try {
        const raw = readFileSync(path, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
/** Analyze system architecture from OpenClaw config. */
export function detectSystemArchitecture() {
    if (_systemState)
        return _systemState;
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
    const hasCompetingMemoryPlugin = memorySlotOwner !== 'default' &&
        memorySlotOwner !== 'none' &&
        competingPlugins.includes(memorySlotOwner) &&
        !!entries[memorySlotOwner]?.enabled;
    // XiaoYi Claw system detection:
    // Either claw-core is explicitly enabled, OR memory slot is assigned to claw-core
    const isXiaoYiClaw = clawCoreEnabled || memorySlotOwner === 'claw-core';
    const version = cfg.meta
        ?.lastTouchedVersion || 'unknown';
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
export function refreshSystemArchitecture() {
    _systemState = null;
    return detectSystemArchitecture();
}
/** Get cached state (lightweight, no file I/O). */
export function getSystemArchitecture() {
    return _systemState;
}
export { getRecommendedStrategy } from "./system-strategy.js";
