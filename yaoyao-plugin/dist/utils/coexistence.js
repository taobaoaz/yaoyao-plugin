/**
 * utils/coexistence.ts — Detect extended-claw presence with runtime refresh.
 *
 * v3 improvements (v4.6 adapter):
 *   - Mmap state reading for zero-copy heartbeat detection (v4.6 Gateway writes /var/claw_shared_state)
 *   - Shorter refresh interval (10s, down from 30s) — v4.6 Gateway heartbeat is 5s
 *   - Version-aware detection (reads Gateway version from mmap)
 *   - Method registry cache (reads _gatewayMethods from mmap)
 *
 * When claw-core is detected, yaoyao enters coexistence mode:
 * - L0 (daily log) still written by yaoyao
 * - L1/L2/FTS5/vector indexing skipped (claw-core handles heavy lifting)
 * - auto-recall delegates to claw-core, then supplements with yaoyao results
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readMmapState, isGatewayAlive } from "./mmap-state.js";
let _state = {
    hasClawCore: false,
    hasClawWorker: false,
    udsPath: '',
    mode: 'standalone',
    flags: {
        skipLocalIndexing: false,
        useClawPrimaryRecall: false,
        forwardCaptureToClaw: false,
    },
    lastCheckedAt: 0,
    checkCount: 0,
    gatewayVersion: null,
    gatewayAlive: false,
};
let _refreshTimer = null;
const _listeners = [];
/** Global query — used by hooks to know current mode. */
export function getCoexistState() {
    return Object.freeze({ ..._state });
}
/** Backward-compatible alias. */
export function getCoexistMode() {
    return _state.mode;
}
/** External force-set (used by entry/index.ts when config detects XiaoYi Claw). */
export function setCoexistMode(mode) {
    const prev = _state;
    const next = { ...prev, mode, flags: _deriveFlags(mode), lastCheckedAt: Date.now() };
    _setState(next);
}
/** Subscribe to state transitions. */
export function onCoexistChange(fn) {
    _listeners.push(fn);
    return () => {
        const idx = _listeners.indexOf(fn);
        if (idx >= 0)
            _listeners.splice(idx, 1);
    };
}
function _deriveFlags(mode) {
    if (mode === 'coexist') {
        return {
            skipLocalIndexing: true,
            useClawPrimaryRecall: true,
            forwardCaptureToClaw: true,
        };
    }
    if (mode === 'disabled') {
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
function _setState(next) {
    const prev = _state;
    _state = next;
    if (prev.mode !== next.mode) {
        for (const fn of _listeners) {
            try {
                fn(prev, next);
            }
            catch { /* intentionally empty */ }
        }
    }
}
/** Detect whether extended-claw core is installed / running. */
export function detectCoexistence(homeDir) {
    const home = homeDir || process.env.HOME || '/home/sandbox';
    const udsPath = path.join(home, '.openclaw/extensions/claw-core/var/claw-worker.sock');
    const hasUds = existsSync(udsPath);
    const extDir = path.join(home, '.openclaw/extensions/claw-core');
    const hasExt = existsSync(extDir);
    // v4.6: Read mmap heartbeat for zero-copy detection
    const gatewayAlive = isGatewayAlive(15000);
    const mmapState = readMmapState();
    const gatewayVersion = mmapState?.version ?? null;
    // v4.6: Either UDS socket OR mmap heartbeat indicates claw-core presence
    const hasWorker = hasUds || gatewayAlive;
    // Environment-variable override (for testing or emergency manual control)
    const envMode = process.env.YAOYAO_COEXIST_MODE;
    const effectiveMode = envMode && ['standalone', 'coexist', 'disabled'].includes(envMode)
        ? envMode
        : hasWorker
            ? 'coexist'
            : 'standalone';
    const next = {
        hasClawCore: hasExt,
        hasClawWorker: hasWorker,
        udsPath,
        mode: effectiveMode,
        flags: _deriveFlags(effectiveMode),
        lastCheckedAt: Date.now(),
        checkCount: _state.checkCount + 1,
        gatewayVersion,
        gatewayAlive,
    };
    _setState(next);
    return next;
}
/** Runtime re-check (e.g. after claw-core starts post-yaoyao). */
export function refreshCoexistence() {
    return detectCoexistence();
}
/** Start periodic auto-refresh (default every 10s for v4.6 rapid detection). Call once at plugin init. */
export function startCoexistenceMonitor(intervalMs = 10000) {
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
export function stopCoexistenceMonitor() {
    if (_refreshTimer) {
        clearInterval(_refreshTimer);
        _refreshTimer = null;
    }
}
