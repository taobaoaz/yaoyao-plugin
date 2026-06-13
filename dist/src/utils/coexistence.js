/**
 * utils/coexistence.ts — Coexistence mode detection and monitoring.
 *
 * v1.7.9+: XiaoYi-specific detection removed. Uses generic signals.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function _checkConfigSlotOwner() {
    try {
        const configPath = join(homedir(), ".openclaw", "openclaw.json");
        if (!existsSync(configPath)) return false;
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw);
        const slots = config.slots;
        if (slots?.memory && slots.memory !== "yaoyao-memory") {
            return true;
        }
        const plugins = config.plugins;
        const entries = plugins?.entries;
        if (entries) {
            for (const val of Object.values(entries)) {
                const name = (val?.name || '').toLowerCase();
                if (name.includes("claw-core") || name.includes("memory-core")) {
                    return true;
                }
            }
        }
        return false;
    }
    catch { return false; }
}

export function _checkUdsSocket() {
    const tmpDir = "/tmp";
    if (existsSync(tmpDir)) {
        try {
            const entries = readdirSync(tmpDir);
            if (entries.some(e => (e.includes("claw-worker") || e.includes("claw_core")) && e.endsWith(".sock"))) {
                return true;
            }
        } catch { }
    }
    try {
        const extDir = join(homedir(), ".openclaw", "extensions");
        if (existsSync(extDir)) {
            const entries = readdirSync(extDir);
            if (entries.includes("claw-core")) {
                const varDir = join(extDir, "claw-core", "var");
                if (existsSync(varDir)) return true;
            }
        }
    } catch { }
    return false;
}

export function _doDetect() {
    if (_checkConfigSlotOwner()) {
        return { mode: 'coexist', timestamp: Date.now(), gatewayVersion: '', gatewayAlive: true };
    }
    if (_checkUdsSocket()) {
        return { mode: 'coexist', timestamp: Date.now(), gatewayVersion: '', gatewayAlive: true };
    }
    return { mode: 'standalone', timestamp: Date.now(), gatewayVersion: '', gatewayAlive: false };
}

const STARTUP_GRACE_MS = 600;
let _currentMode = 'unknown';
let _currentState = { mode: 'unknown', timestamp: Date.now(), gatewayVersion: '', gatewayAlive: false };
let _startedAt = Date.now();
let _changeHandlers = [];

function _isInStartupGrace() {
    return Date.now() - _startedAt < STARTUP_GRACE_MS;
}

export function detectCoexistence() {
    if (_isInStartupGrace()) return _currentState;
    return _doDetect();
}

export function setCoexistMode(mode) {
    const prev = { ..._currentState };
    _currentMode = mode;
    _currentState = { mode, timestamp: Date.now(), gatewayVersion: _currentState.gatewayVersion, gatewayAlive: _currentState.gatewayAlive };
    if (!_isInStartupGrace()) {
        for (const handler of _changeHandlers) {
            handler(prev, _currentState);
        }
    }
}

export function getCoexistMode() {
    return _currentMode;
}

export function getCoexistState() {
    return { ..._currentState };
}

export function startCoexistenceMonitor(intervalMs) {
    const timer = setInterval(() => {
        if (_isInStartupGrace()) return;
        const current = detectCoexistence();
        if (current.mode !== _currentMode) {
            setCoexistMode(current.mode);
        }
    }, intervalMs);
    return () => clearInterval(timer);
}

export function onCoexistChange(handler) {
    _changeHandlers.push(handler);
}