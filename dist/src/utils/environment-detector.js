/**
 * utils/environment-detector.ts — Environment detection for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw detection removed. Only detects OpenClaw.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export function detectByFileSystem() {
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

export function detectByEnvVars() {
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

export function detectByGlobalMarkers() {
    const signals = [];
    const g = globalThis;
    if (g.__OPENCLAW__) {
        signals.push("__OPENCLAW__ global marker");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}

export function detectByModules() {
    const signals = [];
    try {
        require.resolve("openclaw/plugin-sdk");
        signals.push("openclaw/plugin-sdk module");
        return { env: "openclaw", signals };
    }
    catch { }
    return { env: "unknown", signals };
}

export function detectByConfigFile() {
    const signals = [];
    const ocConfigPath = join(homedir(), ".openclaw", "openclaw.json");
    if (existsSync(ocConfigPath)) {
        signals.push("found openclaw.json");
        return { env: "openclaw", signals };
    }
    return { env: "unknown", signals };
}

export function detectEnvironment() {
    const allSignals = [];
    const fsResult = detectByFileSystem();
    if (fsResult.env !== "unknown") {
        allSignals.push(...fsResult.signals);
        return { env: fsResult.env, confidence: "high", signals: allSignals };
    }
    const configResult = detectByConfigFile();
    if (configResult.env !== "unknown") {
        allSignals.push(...configResult.signals);
        return { env: configResult.env, confidence: "high", signals: allSignals };
    }
    const envResult = detectByEnvVars();
    if (envResult.env !== "unknown") {
        allSignals.push(...envResult.signals);
        return { env: envResult.env, confidence: "high", signals: allSignals };
    }
    const globalResult = detectByGlobalMarkers();
    if (globalResult.env !== "unknown") {
        allSignals.push(...globalResult.signals);
        return { env: globalResult.env, confidence: "medium", signals: allSignals };
    }
    const moduleResult = detectByModules();
    if (moduleResult.env !== "unknown") {
        allSignals.push(...moduleResult.signals);
        return { env: moduleResult.env, confidence: "medium", signals: allSignals };
    }
    return { env: "unknown", confidence: "low", signals: ["no reliable detection signals"] };
}

export function isXiaoYiClaw() {
    return false;
}

export function isOpenClaw() {
    return detectEnvironment().env === "openclaw";
}

export function getEnvironmentInfo() {
    const result = detectEnvironment();
    return `Environment: ${result.env} (confidence: ${result.confidence}, signals: ${result.signals.join(", ")})`;
}