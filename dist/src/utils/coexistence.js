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
/** Startup grace period before coexistence detection activates (ms). */
const STARTUP_GRACE_MS = 600;
let _currentMode = 'unknown';
let _currentState = {
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
let _startedAt = Date.now();
let _changeHandlers = [];
function _isInStartupGrace() {
    return Date.now() - _startedAt < STARTUP_GRACE_MS;
}
/** Read openclaw.json to check if memory slot is owned by another system. */
function _checkConfigSlotOwner() {
    try {
        const configPath = join(homedir(), ".openclaw", "openclaw.json");
        if (!existsSync(configPath))
            return false;
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw);
        const slots = config.slots;
        if (slots?.memory && slots.memory !== "yaoyao-memory") {
            return true;
        }
        // Check extensions/plugins for claw-core or gspd_memory (v1.8.0)
        const plugins = config.plugins;
        const entries = plugins?.entries;
        if (entries) {
            for (const val of Object.values(entries)) {
                const name = (val?.name || '').toLowerCase();
                if (name.includes("claw-core") || name.includes("memory-core") || name.includes("gspd_memory") || name.includes("gspd-memory")) {
                    return true;
                }
            }
        }
        return false;
    }
    catch {
        return false;
    }
}
/** Check for UDS socket files indicating claw-core worker is running. */
function _checkUdsSocket() {
    // Linux/macOS: /tmp
    const tmpDir = "/tmp";
    if (existsSync(tmpDir)) {
        try {
            const entries = readdirSync(tmpDir);
            if (entries.some(e => (e.includes("claw-worker") || e.includes("claw_core")) && e.endsWith(".sock"))) {
                return true;
            }
        }
        catch {
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
                if (existsSync(varDir))
                    return true;
            }
            // v1.8.0: gspd_memory plugin presence
            if (entries.includes("gspd_memory") || entries.includes("gspd-memory")) {
                return true;
            }
        }
    }
    catch {
        // ignore
    }
    return false;
}
/** v1.8.0: Check for core_skills directory (generic claw-core signal) */
function _checkCoreSkills() {
    try {
        const possibleRoots = [
            process.env.OPENCLAW_HOME,
            homedir(),
        ].filter(Boolean);
        for (const root of possibleRoots) {
            const coreSkillsDir = join(root, ".openclaw", "core_skills");
            if (existsSync(coreSkillsDir)) {
                const entries = readdirSync(coreSkillsDir);
                // core_skills with at least one known claw-core skill = strong signal
                if (entries.some(e => e.includes("secret-guardian") || e.includes("execution-validator") || e.includes("skill-scope"))) {
                    return true;
                }
            }
        }
        return false;
    }
    catch {
        return false;
    }
}
/** Actual detection: check if another claw core is running */
function _doDetect() {
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
    // v1.8.0: Check for core_skills (generic claw-core signal)
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
export function detectCoexistence() {
    if (_isInStartupGrace()) {
        return _currentState;
    }
    return _doDetect();
}
export function setCoexistMode(mode) {
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
export function getCoexistMode() {
    return _currentMode;
}
export function getCoexistState() {
    return { ..._currentState };
}
export function startCoexistenceMonitor(intervalMs) {
    const timer = setInterval(() => {
        if (_isInStartupGrace())
            return;
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
