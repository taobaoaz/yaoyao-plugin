/**
 * utils/environment-detector.ts — Environment detection for OpenClaw.
 *
 * v1.8.0: XiaoYi environment detection restored as additive layer.
 *   - Base detection: openclaw vs unknown (unchanged)
 *   - XiaoYi layer: detects XiaoYi-specific signals ON TOP of openclaw
 *   - Security level: detects hardened security environment
 *   - All XiaoYi paths are optional; standard OpenClaw unaffected.
 *
 * Detection priority (most reliable first):
 * 1. File system signatures (directory structure)
 * 2. Configuration files (openclaw.json)
 * 3. Environment variables
 * 4. Global markers
 * 5. Module presence
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
// === Cached XiaoYi detection result ===
let _cachedXiaoYi = null;
// === File System Signatures ===
function detectByFileSystem() {
    const signals = [];
    const possibleRoots = [
        process.env.OPENCLAW_HOME,
        process.cwd(),
        dirname(process.cwd()),
    ].filter(Boolean);
    for (const root of possibleRoots) {
        // OpenClaw has plugins/ or .openclaw/extensions/
        const ocExtDir = join(root, ".openclaw", "extensions");
        if (existsSync(ocExtDir)) {
            signals.push(`found openclaw extensions in ${ocExtDir}`);
            return { env: "openclaw", signals };
        }
        const pluginsDir = join(root, "plugins");
        if (existsSync(pluginsDir)) {
            signals.push(`found plugins directory in ${pluginsDir}`);
            return { env: "openclaw", signals };
        }
    }
    return { env: "unknown", signals };
}
// === Environment Variables ===
function detectByEnvVars() {
    const signals = [];
    // OpenClaw specific
    if (process.env.OPENCLAW_CONFIG_PATH) {
        signals.push("OPENCLAW_CONFIG_PATH set");
        return { env: "openclaw", signals };
    }
    if (process.env.OPENCLAW_HOME) {
        signals.push("OPENCLAW_HOME set");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}
// === Global Markers ===
function detectByGlobalMarkers() {
    const signals = [];
    const g = globalThis;
    if (g.__OPENCLAW__) {
        signals.push("__OPENCLAW__ global marker");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}
// === Module Presence ===
function detectByModules() {
    const signals = [];
    try {
        require.resolve("openclaw/plugin-sdk");
        signals.push("openclaw/plugin-sdk module");
        return { env: "openclaw", signals };
    }
    catch {
        // not found
    }
    return { env: "unknown", signals };
}
// === Configuration File Detection ===
function detectByConfigFile() {
    const signals = [];
    // Check for OpenClaw config
    const ocConfigPath = join(homedir(), ".openclaw", "openclaw.json");
    if (existsSync(ocConfigPath)) {
        signals.push("found openclaw.json");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}
// =====================================================
// XiaoYi Detection Layer (additive on top of OpenClaw)
// =====================================================
function _readOpenClawConfig() {
    try {
        const configPath = join(homedir(), ".openclaw", "openclaw.json");
        if (!existsSync(configPath))
            return null;
        return JSON.parse(readFileSync(configPath, "utf-8"));
    }
    catch {
        return null;
    }
}
/** Check for xiaoyi-channel plugin in extensions directory (high confidence) */
function _checkXiaoYiChannel() {
    try {
        const extDir = join(homedir(), ".openclaw", "extensions");
        if (!existsSync(extDir))
            return false;
        const entries = readdirSync(extDir);
        return entries.some(e => e.includes("xiaoyi-channel"));
    }
    catch {
        return false;
    }
}
/** Check for core_skills directory with secret-guardian (high confidence) */
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
                if (entries.includes("secret-guardian") || entries.includes("execution-validator-skill")) {
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
/** Check for SOUL.md + IDENTITY.md in workspace (medium confidence) */
function _checkWorkspaceSoul() {
    try {
        const workspaceDir = join(homedir(), ".openclaw", "workspace");
        return existsSync(join(workspaceDir, "SOUL.md")) && existsSync(join(workspaceDir, "IDENTITY.md"));
    }
    catch {
        return false;
    }
}
/** Check if provider is xiaoyiprovider in openclaw.json (medium confidence) */
function _checkXiaoYiProvider() {
    try {
        const config = _readOpenClawConfig();
        if (!config)
            return false;
        const provider = config.provider;
        if (typeof provider === "string")
            return provider.includes("xiaoyi");
        if (provider && typeof provider === "object") {
            const name = provider.name;
            const baseUrl = provider.baseUrl;
            if (name && name.includes("xiaoyi"))
                return true;
            if (baseUrl && baseUrl.includes("xiaoyi"))
                return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
/** Check env vars for XiaoYi signals (low confidence) */
function _checkXiaoYiEnvVars() {
    const active = process.env.XIAOYI_CHANNEL_ACTIVE === "1" || process.env.XIAOYI_CHANNEL_ACTIVE === "true";
    const deviceType = process.env.XIAOYI_DEVICE_TYPE || "";
    return { active: active || !!deviceType, deviceType };
}
/** Detect security level based on core_skills presence */
function _detectSecurityLevel() {
    try {
        const possibleRoots = [process.env.OPENCLAW_HOME, homedir()].filter(Boolean);
        for (const root of possibleRoots) {
            const coreSkillsDir = join(root, ".openclaw", "core_skills");
            if (existsSync(coreSkillsDir)) {
                const entries = readdirSync(coreSkillsDir);
                const hasSecretGuardian = entries.includes("secret-guardian");
                const hasValidator = entries.includes("execution-validator-skill") || entries.includes("execution-validator");
                if (hasSecretGuardian && hasValidator)
                    return "hardened";
                if (hasSecretGuardian || hasValidator)
                    return "standard";
            }
        }
        return "unknown";
    }
    catch {
        return "unknown";
    }
}
/**
 * Detect XiaoYi environment signals.
 * Returns cached result on subsequent calls.
 * "宁可漏检不可误判": requires at least one high-confidence signal,
 * OR two medium-confidence signals.
 */
export function detectXiaoYiSignals() {
    if (_cachedXiaoYi)
        return _cachedXiaoYi;
    const signals = [];
    let highConfidence = 0;
    let mediumConfidence = 0;
    // High confidence signals
    if (_checkXiaoYiChannel()) {
        signals.push("xiaoyi-channel plugin found");
        highConfidence++;
    }
    if (_checkCoreSkills()) {
        signals.push("core_skills with secret-guardian found");
        highConfidence++;
    }
    // Medium confidence signals
    if (_checkWorkspaceSoul()) {
        signals.push("SOUL.md + IDENTITY.md in workspace");
        mediumConfidence++;
    }
    if (_checkXiaoYiProvider()) {
        signals.push("xiaoyiprovider in config");
        mediumConfidence++;
    }
    // Low confidence: env vars
    const envResult = _checkXiaoYiEnvVars();
    const detected = highConfidence >= 1 || mediumConfidence >= 2;
    const result = {
        detected,
        deviceType: envResult.deviceType || _inferDeviceType(),
        channelActive: signals.some(s => s.includes("xiaoyi-channel")) || envResult.active,
        skillsAvailable: signals.some(s => s.includes("core_skills")),
        securityLevel: _detectSecurityLevel(),
        signals,
    };
    _cachedXiaoYi = result;
    return result;
}
/** Try to infer device type from workspace files */
function _inferDeviceType() {
    try {
        const idPath = join(homedir(), ".openclaw", "workspace", "IDENTITY.md");
        if (!existsSync(idPath))
            return "";
        const content = readFileSync(idPath, "utf-8");
        const match = content.match(/device[_\s-]*type[:\s]+(pad|phone|tablet)/i);
        if (match)
            return match[1].toLowerCase();
        return "";
    }
    catch {
        return "";
    }
}
// === Main Detection ===
export function detectEnvironment() {
    const allSignals = [];
    // Priority 1: File system (most reliable, hard to fake)
    const fsResult = detectByFileSystem();
    if (fsResult.env !== "unknown") {
        allSignals.push(...fsResult.signals);
        // Check for XiaoYi signals on top of OpenClaw
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }
    // Priority 2: Configuration files
    const configResult = detectByConfigFile();
    if (configResult.env !== "unknown") {
        allSignals.push(...configResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }
    // Priority 3: Environment variables
    const envResult = detectByEnvVars();
    if (envResult.env !== "unknown") {
        allSignals.push(...envResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }
    // Priority 4: Global markers
    const globalResult = detectByGlobalMarkers();
    if (globalResult.env !== "unknown") {
        allSignals.push(...globalResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "medium", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "medium", signals: allSignals };
    }
    // Priority 5: Module presence (least reliable, can be mocked)
    const moduleResult = detectByModules();
    if (moduleResult.env !== "unknown") {
        allSignals.push(...moduleResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "medium", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "medium", signals: allSignals };
    }
    return { env: "unknown", confidence: "low", signals: ["no reliable detection signals"] };
}
// === Convenience Functions ===
export function isXiaoYiClaw() {
    return detectXiaoYiSignals().detected;
}
export function isOpenClaw() {
    const env = detectEnvironment().env;
    return env === "openclaw" || env === "openclaw-xiaoyi";
}
/** Return full XiaoYi environment snapshot for other modules */
export function getXiaoYiEnv() {
    return detectXiaoYiSignals();
}
/** Return current security level */
export function getSecurityLevel() {
    return detectXiaoYiSignals().securityLevel;
}
export function getEnvironmentInfo() {
    const result = detectEnvironment();
    let info = `Environment: ${result.env} (confidence: ${result.confidence}, signals: ${result.signals.join(", ")})`;
    if (result.xiaoyi) {
        info += ` | XiaoYi: device=${result.xiaoyi.deviceType || "unknown"}, channel=${result.xiaoyi.channelActive}, security=${result.xiaoyi.securityLevel}`;
    }
    return info;
}
