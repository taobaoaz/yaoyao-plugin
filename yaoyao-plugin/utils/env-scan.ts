/**
 * EnvScan — runtime environment capability detection.
 *
 * Scans the host for available capabilities (FTS5, vector DB, LLM, cloud sync)
 * and produces a capability matrix for adaptive feature registration.
 */

import fs from "node:fs";
import path from "node:path";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { EmbeddingSource } from "./env-scan-embed.ts";
import { scanEmbeddingSources, generateSetupGuide } from "./env-scan-embed.ts";

export interface CapabilityMatrix {
  fts5: boolean;
  vector: boolean;
  llm: boolean;
  cloudSync: boolean;
  nodeVersion: string;
  platform: string;
}

export function scanEnvironment(logger?: PluginLogger): CapabilityMatrix {
  const nodeVersion = process.version;
  const platform = process.platform;

  // FTS5: check if sqlite3 was compiled with FTS5
  let fts5 = false;
  try {
    const sqlite3 = require("sqlite3");
    const db = new sqlite3.Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE test USING fts5(a)");
    db.close();
    fts5 = true;
  } catch {
    fts5 = false;
  }

  // Vector: check for sqlite-vec or hnswlib availability
  let vector = false;
  try {
    require("sqlite-vec");
    vector = true;
  } catch {
    try {
      require("hnswlib-node");
      vector = true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      vector = false;
    }
  }

  // LLM: check for openai or compatible client
  let llm = false;
  try {
    require("openai");
    llm = true;
  } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      llm = false;
    }

  // Cloud sync: check for common cloud SDKs
  let cloudSync = false;
  const cloudModules = ["aws-sdk", "@aws-sdk/client-s3", "webdav", "ssh2", "smb2"];
  for (const mod of cloudModules) {
    try {
      require(mod);
      cloudSync = true;
      break;
    } catch {
      // continue
    }
  }

  const matrix: CapabilityMatrix = {
    fts5,
    vector,
    llm,
    cloudSync,
    nodeVersion,
    platform,
  };

  logger?.info?.(
    `[yaoyao-memory:env] Capability matrix — FTS5:${fts5 ? "✅" : "❌"} Vec:${vector ? "✅" : "❌"} LLM:${llm ? "✅" : "❌"} Cloud:${cloudSync ? "✅" : "❌"} Node:${nodeVersion} Platform:${platform}`,
  );

  return matrix;
}

/** Adaptive registration helper: skip features when dependencies are missing */
export function shouldRegisterFeature(
  featureName: string,
  required: (keyof CapabilityMatrix)[],
  matrix: CapabilityMatrix,
  logger?: PluginLogger,
): boolean {
  const missing = required.filter((cap) => !matrix[cap]);
  if (missing.length > 0) {
    logger?.warn?.(
      `[yaoyao-memory:env] Skipping ${featureName} — missing: ${missing.join(", ")}`,
    );
    return false;
  }
  return true;
}

/** Check if this appears to be the first install (no .yaoyao.db yet). */
export function isFirstInstall(baseDir: string): boolean {
  const dbPath = path.join(baseDir, ".yaoyao.db");
  return !fs.existsSync(dbPath);
}

// Re-export embedding scan utilities
export type { EmbeddingSource } from "./env-scan-embed.ts";
export { scanEmbeddingSources, generateSetupGuide } from "./env-scan-embed.ts";
