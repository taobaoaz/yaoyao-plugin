/**
 * utils/environment-detector.ts — Environment detection for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw detection removed. Only detects OpenClaw.
 * Detection priority (most reliable first):
 * 1. File system signatures (directory structure)
 * 2. Environment variables
 * 3. Global markers
 * 4. Module presence
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export type ClawEnvironment = "openclaw" | "unknown";

interface DetectionResult {
  env: ClawEnvironment;
  confidence: "high" | "medium" | "low";
  signals: string[];
}

// === File System Signatures ===

function detectByFileSystem(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

  const possibleRoots = [
    process.env.OPENCLAW_HOME,
    process.cwd(),
    dirname(process.cwd()),
  ].filter(Boolean) as string[];

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

function detectByEnvVars(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

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

function detectByGlobalMarkers(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];
  const g = globalThis as Record<string, unknown>;

  if (g.__OPENCLAW__) {
    signals.push("__OPENCLAW__ global marker");
    return { env: "openclaw", signals };
  }

  return { env: "unknown", signals };
}

// === Module Presence ===

function detectByModules(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

  try {
    require.resolve("openclaw/plugin-sdk");
    signals.push("openclaw/plugin-sdk module");
    return { env: "openclaw", signals };
  } catch {
    // not found
  }

  return { env: "unknown", signals };
}

// === Configuration File Detection ===

function detectByConfigFile(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

  // Check for OpenClaw config
  const ocConfigPath = join(homedir(), ".openclaw", "openclaw.json");
  if (existsSync(ocConfigPath)) {
    signals.push("found openclaw.json");
    return { env: "openclaw", signals };
  }

  return { env: "unknown", signals };
}

// === Main Detection ===

export function detectEnvironment(): DetectionResult {
  const allSignals: string[] = [];

  // Priority 1: File system (most reliable, hard to fake)
  const fsResult = detectByFileSystem();
  if (fsResult.env !== "unknown") {
    allSignals.push(...fsResult.signals);
    return { env: fsResult.env, confidence: "high", signals: allSignals };
  }

  // Priority 2: Configuration files
  const configResult = detectByConfigFile();
  if (configResult.env !== "unknown") {
    allSignals.push(...configResult.signals);
    return { env: configResult.env, confidence: "high", signals: allSignals };
  }

  // Priority 3: Environment variables
  const envResult = detectByEnvVars();
  if (envResult.env !== "unknown") {
    allSignals.push(...envResult.signals);
    return { env: envResult.env, confidence: "high", signals: allSignals };
  }

  // Priority 4: Global markers
  const globalResult = detectByGlobalMarkers();
  if (globalResult.env !== "unknown") {
    allSignals.push(...globalResult.signals);
    return { env: globalResult.env, confidence: "medium", signals: allSignals };
  }

  // Priority 5: Module presence (least reliable, can be mocked)
  const moduleResult = detectByModules();
  if (moduleResult.env !== "unknown") {
    allSignals.push(...moduleResult.signals);
    return { env: moduleResult.env, confidence: "medium", signals: allSignals };
  }

  return { env: "unknown", confidence: "low", signals: ["no reliable detection signals"] };
}

// === Convenience Functions ===

export function isXiaoYiClaw(): boolean {
  return false;
}

export function isOpenClaw(): boolean {
  return detectEnvironment().env === "openclaw";
}

export function getEnvironmentInfo(): string {
  const result = detectEnvironment();
  return `Environment: ${result.env} (confidence: ${result.confidence}, signals: ${result.signals.join(", ")})`;
}