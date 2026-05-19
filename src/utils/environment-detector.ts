/**
 * utils/environment-detector.ts — Robust environment detection for OpenClaw vs XiaoYi Claw.
 * 
 * Detection priority (most reliable first):
 * 1. File system signatures (directory structure)
 * 2. Environment variables
 * 3. Global markers
 * 4. Module presence
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type ClawEnvironment = "openclaw" | "xiaoyi-claw" | "unknown";

interface DetectionResult {
  env: ClawEnvironment;
  confidence: "high" | "medium" | "low";
  signals: string[];
}

// === File System Signatures ===

function detectByFileSystem(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];
  
  // Check for XiaoYi Claw directory structure
  const possibleRoots = [
    process.env.XIAOYI_CLAW_HOME,
    process.env.OPENCLAW_HOME,
    process.cwd(),
    dirname(process.cwd()),
  ].filter(Boolean) as string[];

  for (const root of possibleRoots) {
    // XiaoYi Claw has extensions/ directory with claw-core
    const extDir = join(root, "extensions");
    if (existsSync(extDir)) {
      try {
        const entries = readdirSync(extDir);
        if (entries.includes("claw-core") || entries.includes("xiaoyi-channel")) {
          signals.push(`found xiaoyi extensions in ${extDir}`);
          return { env: "xiaoyi-claw", signals };
        }
        if (entries.includes("openclaw-better-gateway")) {
          signals.push(`found xiaoyi-specific gateway in ${extDir}`);
          return { env: "xiaoyi-claw", signals };
        }
        // v4.3: xiaoyi plugin directory
        if (entries.includes("xiaoyi")) {
          const xiaoyiDir = join(extDir, "xiaoyi");
          if (existsSync(join(xiaoyiDir, "xiaoyi.js"))) {
            signals.push(`found xiaoyi plugin at ${xiaoyiDir}`);
            return { env: "xiaoyi-claw", signals };
          }
        }
      } catch {
        // ignore read errors
      }
    }

    // OpenClaw has plugins/ or .openclaw/extensions/
    const ocExtDir = join(root, ".openclaw", "extensions");
    if (existsSync(ocExtDir)) {
      signals.push(`found openclaw extensions in ${ocExtDir}`);
      return { env: "openclaw", signals };
    }
  }

  // v4.3: Check for UDS socket files
  const tmpDir = "/tmp";
  if (existsSync(tmpDir)) {
    try {
      const entries = readdirSync(tmpDir);
      if (entries.some(e => e.startsWith("xiaoyi_worker_") && e.endsWith(".sock"))) {
        signals.push("found xiaoyi UDS socket files");
        return { env: "xiaoyi-claw", signals };
      }
    } catch {
      // ignore
    }
  }

  // v4.3: Check for mmap shared memory directory
  const shmDir = "/dev/shm";
  if (existsSync(shmDir)) {
    try {
      const entries = readdirSync(shmDir);
      if (entries.some(e => e.startsWith("xiaoyi_"))) {
        signals.push("found xiaoyi shared memory segments");
        return { env: "xiaoyi-claw", signals };
      }
    } catch {
      // ignore
    }
  }

  return { env: "unknown", signals };
}

// === Environment Variables ===

function detectByEnvVars(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

  // XiaoYi Claw specific
  if (process.env.XIAOYI_CLAW_HOME) {
    signals.push("XIAOYI_CLAW_HOME set");
    return { env: "xiaoyi-claw", signals };
  }
  if (process.env.XIAOYI_CLAW_VERSION) {
    signals.push("XIAOYI_CLAW_VERSION set");
    return { env: "xiaoyi-claw", signals };
  }
  // v4.3: Worker environment
  if (process.env.XIAOYI_WORKER_ID) {
    signals.push("XIAOYI_WORKER_ID set");
    return { env: "xiaoyi-claw", signals };
  }
  if (process.env.ZMQ_PUB_ENDPOINT) {
    signals.push("ZMQ_PUB_ENDPOINT set");
    return { env: "xiaoyi-claw", signals };
  }

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

  if (g.__XIAOYI_CLAW__) {
    signals.push("__XIAOYI_CLAW__ global marker");
    return { env: "xiaoyi-claw", signals };
  }
  if (g.__OPENCLAW__) {
    signals.push("__OPENCLAW__ global marker");
    return { env: "openclaw", signals };
  }

  return { env: "unknown", signals };
}

// === Module Presence ===

function detectByModules(): { env: ClawEnvironment; signals: string[] } {
  const signals: string[] = [];

  // Check for XiaoYi Claw specific modules
  try {
    require.resolve("xiaoyi-claw-sdk");
    signals.push("xiaoyi-claw-sdk module");
    return { env: "xiaoyi-claw", signals };
  } catch {
    // not found
  }

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
  const homedir = require("os").homedir();

  // Check for OpenClaw config
  const ocConfigPath = join(homedir, ".openclaw", "openclaw.json");
  if (existsSync(ocConfigPath)) {
    try {
      const config = JSON.parse(require("fs").readFileSync(ocConfigPath, "utf8"));
      if (config.channels?.xiaoyi || config.plugins?.entries?.xiaoyi) {
        signals.push("openclaw.json has xiaoyi channel config");
        return { env: "xiaoyi-claw", signals };
      }
      signals.push("found openclaw.json");
      return { env: "openclaw", signals };
    } catch {
      // ignore parse errors
    }
  }

  // Check for xiaoyi-specific config files
  const xiaoyiConfigPaths = [
    join(homedir, ".openclaw", "xiaoyi_claw_config.yaml"),
    join(homedir, ".openclaw", "xiaoyi_config.json"),
    join(process.cwd(), "xiaoyi_claw_config.yaml"),
  ];

  for (const path of xiaoyiConfigPaths) {
    if (existsSync(path)) {
      signals.push(`found xiaoyi config at ${path}`);
      return { env: "xiaoyi-claw", signals };
    }
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
    return {
      env: fsResult.env,
      confidence: "high",
      signals: allSignals,
    };
  }

  // Priority 2: Configuration files
  const configResult = detectByConfigFile();
  if (configResult.env !== "unknown") {
    allSignals.push(...configResult.signals);
    return {
      env: configResult.env,
      confidence: "high",
      signals: allSignals,
    };
  }

  // Priority 3: Environment variables
  const envResult = detectByEnvVars();
  if (envResult.env !== "unknown") {
    allSignals.push(...envResult.signals);
    return {
      env: envResult.env,
      confidence: "high",
      signals: allSignals,
    };
  }

  // Priority 4: Global markers
  const globalResult = detectByGlobalMarkers();
  if (globalResult.env !== "unknown") {
    allSignals.push(...globalResult.signals);
    return {
      env: globalResult.env,
      confidence: "medium",
      signals: allSignals,
    };
  }

  // Priority 5: Module presence (least reliable, can be mocked)
  const moduleResult = detectByModules();
  if (moduleResult.env !== "unknown") {
    allSignals.push(...moduleResult.signals);
    return {
      env: moduleResult.env,
      confidence: "medium",
      signals: allSignals,
    };
  }

  return {
    env: "unknown",
    confidence: "low",
    signals: ["no reliable detection signals"],
  };
}

// === Convenience Functions ===

export function isXiaoYiClaw(): boolean {
  return detectEnvironment().env === "xiaoyi-claw";
}

export function isOpenClaw(): boolean {
  return detectEnvironment().env === "openclaw";
}

export function getEnvironmentInfo(): string {
  const result = detectEnvironment();
  return `Environment: ${result.env} (confidence: ${result.confidence}, signals: ${result.signals.join(", ")})`;
}
