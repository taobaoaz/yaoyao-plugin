/**
 * Coexistence mode detection and monitoring.
 *
 * v1.7.8+: Added startup grace period to prevent false "claw-core disappeared"
 * during gspd initialization (600ms warm-up window).
 */
import { detectEnvironment, isXiaoYiClaw, isOpenClaw } from "./environment-detector.js";
/** Startup grace period before coexistence detection activates (ms). */
const STARTUP_GRACE_MS = 600;
let _currentMode = 'unknown';
let _currentState = {
    mode: 'unknown',
    timestamp: Date.now(),
    gatewayVersion: '',
    gatewayAlive: false,
};
let _startedAt = Date.now();
let _changeHandlers = [];
function _isInStartupGrace() {
    return Date.now() - _startedAt < STARTUP_GRACE_MS;
}
/** Actual detection: check if another claw core is running */
function _doDetect() {
    const env = detectEnvironment();
    // If we detect XiaoYi Claw processes, we're in coexist mode
    if (isXiaoYiClaw()) {
        return {
            mode: 'coexist',
            timestamp: Date.now(),
            gatewayVersion: '',
            gatewayAlive: true,
        };
    }
    // If we detect OpenClaw and no XiaoYi, we're standalone
    if (isOpenClaw()) {
        return {
            mode: 'standalone',
            timestamp: Date.now(),
            gatewayVersion: '',
            gatewayAlive: true,
        };
    }
    // Unknown — keep previous state to avoid flapping
    return {
        ..._currentState,
        timestamp: Date.now(),
    };
}
export function detectCoexistence() {
    if (_isInStartupGrace()) {
        // During startup grace period, hold the current state — don't flip to standalone
        return _currentState;
    }
    // After grace period, run actual detection
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
    // Skip change notification during startup grace to avoid false flips
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
        // Periodic detection — but skip during startup grace
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
