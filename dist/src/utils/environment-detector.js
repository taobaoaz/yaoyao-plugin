/**
 * utils/environment-detector.ts — Environment detection for OpenClaw.
 *
 * v1.8.0: XiaoYi environment detection restored as additive layer.
 *   - Base detection: openclaw vs unknown (unchanged)
 *   - XiaoYi layer: detects XiaoYi-specific signals ON TOP of openclaw
 *   - Security level: detects hardened security environment
 *   - All XiaoYi paths are optional; standard OpenClaw unaffected.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let _cachedXiaoYi = null;

function detectByFileSystem() {
    const signals = [];
    const possibleRoots = [
        process.env.OPENCLAW_HOME,
        process.cwd(),
        dirname(process.cwd()),
    ].filter(Boolean);

    for (const root of possibleRoots) {
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

function detectByEnvVars() {
    const signals = [];
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

function detectByGlobalMarkers() {
    const signals = [];
    const g = globalThis;
    if (g.__OPENCLAW__) {
        signals.push("__OPENCLAW__ global marker");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}

function detectByModules() {
    const signals = [];
    try {
        require.resolve("openclaw/plugin-sdk");
        signals.push("openclaw/plugin-sdk module");
        return { env: "openclaw", signals };
    } catch {
        // not found
    }
    return { env: "unknown", signals };
}

function detectByConfigFile() {
    const signals = [];
    const ocConfigPath = join(homedir(), ".openclaw", "openclaw.json");
    if (existsSync(ocConfigPath)) {
        signals.push("found openclaw.json");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}

// === XiaoYi Detection Layer ===

function _readOpenClawConfig() {
    try {
        const configPath = join(homedir(), ".openclaw", "openclaw.json");
        if (!existsSync(configPath)) return null;
        return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
        return null;
    }
}

function _checkXiaoYiChannel() {
    try {
        const extDir = join(homedir(), ".openclaw", "extensions");
        if (!existsSync(extDir)) return false;
        const entries = readdirSync(extDir);
        return entries.some(e => e.includes("xiaoyi-channel"));
    } catch {
        return false;
    }
}

function _checkCoreSkills() {
    try {
        const possibleRoots = [process.env.OPENCLAW_HOME, homedir()].filter(Boolean);
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
    } catch {
        return false;
    }
}

function _checkWorkspaceSoul() {
    try {
        const workspaceDir = join(homedir(), ".openclaw", "workspace");
        return existsSync(join(workspaceDir, "SOUL.md")) && existsSync(join(workspaceDir, "IDENTITY.md"));
    } catch {
        return false;
    }
}

function _checkXiaoYiProvider() {
    try {
        const config = _readOpenClawConfig();
        if (!config) return false;
        const provider = config.provider;
        if (typeof provider === "string") return provider.includes("xiaoyi");
        if (provider && typeof provider === "object") {
            const name = provider.name;
            const baseUrl = provider.baseUrl;
            if (name && name.includes("xiaoyi")) return true;
            if (baseUrl && baseUrl.includes("xiaoyi")) return true;
        }
        return false;
    } catch {
        return false;
    }
}

function _checkXiaoYiEnvVars() {
    const active = process.env.XIAOYI_CHANNEL_ACTIVE === "1" || process.env.XIAOYI_CHANNEL_ACTIVE === "true";
    const deviceType = process.env.XIAOYI_DEVICE_TYPE || "";
    return { active: active || !!deviceType, deviceType };
}

function _detectSecurityLevel() {
    try {
        const possibleRoots = [process.env.OPENCLAW_HOME, homedir()].filter(Boolean);
        for (const root of possibleRoots) {
            const coreSkillsDir = join(root, ".openclaw", "core_skills");
            if (existsSync(coreSkillsDir)) {
                const entries = readdirSync(coreSkillsDir);
                const hasSecretGuardian = entries.includes("secret-guardian");
                const hasValidator = entries.includes("execution-validator-skill") || entries.includes("execution-validator");
                if (hasSecretGuardian && hasValidator) return "hardened";
                if (hasSecretGuardian || hasValidator) return "standard";
            }
        }
        return "unknown";
    } catch {
        return "unknown";
    }
}

function _inferDeviceType() {
    try {
        const idPath = join(homedir(), ".openclaw", "workspace", "IDENTITY.md");
        if (!existsSync(idPath)) return "";
        const content = readFileSync(idPath, "utf-8");
        const match = content.match(/device[_\s-]*type[:\s]+(pad|phone|tablet)/i);
        if (match) return match[1].toLowerCase();
        return "";
    } catch {
        return "";
    }
}

export function detectXiaoYiSignals() {
    if (_cachedXiaoYi) return _cachedXiaoYi;

    const signals = [];
    let highConfidence = 0;
    let mediumConfidence = 0;

    if (_checkXiaoYiChannel()) {
        signals.push("xiaoyi-channel plugin found");
        highConfidence++;
    }
    if (_checkCoreSkills()) {
        signals.push("core_skills with secret-guardian found");
        highConfidence++;
    }
    if (_checkWorkspaceSoul()) {
        signals.push("SOUL.md + IDENTITY.md in workspace");
        mediumConfidence++;
    }
    if (_checkXiaoYiProvider()) {
        signals.push("xiaoyiprovider in config");
        mediumConfidence++;
    }

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

export function detectEnvironment() {
    const allSignals = [];

    const fsResult = detectByFileSystem();
    if (fsResult.env !== "unknown") {
        allSignals.push(...fsResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }

    const configResult = detectByConfigFile();
    if (configResult.env !== "unknown") {
        allSignals.push(...configResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }

    const envResult = detectByEnvVars();
    if (envResult.env !== "unknown") {
        allSignals.push(...envResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "high", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "high", signals: allSignals };
    }

    const globalResult = detectByGlobalMarkers();
    if (globalResult.env !== "unknown") {
        allSignals.push(...globalResult.signals);
        const xy = detectXiaoYiSignals();
        if (xy.detected) {
            return { env: "openclaw-xiaoyi", confidence: "medium", signals: [...allSignals, ...xy.signals], xiaoyi: xy };
        }
        return { env: "openclaw", confidence: "medium", signals: allSignals };
    }

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

export function isXiaoYiClaw() {
    return detectXiaoYiSignals().detected;
}

export function isOpenClaw() {
    const env = detectEnvironment().env;
    return env === "openclaw" || env === "openclaw-xiaoyi";
}

export function getXiaoYiEnv() {
    return detectXiaoYiSignals();
}

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