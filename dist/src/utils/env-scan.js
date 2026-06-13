/**
 * EnvScan — runtime environment capability detection.
 *
 * Scans the host for available capabilities (FTS5, vector DB, LLM, cloud sync)
 * and produces a capability matrix for adaptive feature registration.
 */
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import fs from "node:fs";
import path from "node:path";
export function scanEnvironment(logger) {
    const nodeVersion = process.version;
    const platform = process.platform;
    // FTS5: check if sqlite3 was compiled with FTS5
    let fts5 = false;
    try {
        const sqlite3 = _require("sqlite3");
        const db = new sqlite3.Database(":memory:");
        db.exec("CREATE VIRTUAL TABLE test USING fts5(a)");
        db.close();
        fts5 = true;
    }
    catch {
        fts5 = false;
    }
    // Vector: check for sqlite-vec or hnswlib availability
    let vector = false;
    try {
        _require("sqlite-vec");
        vector = true;
    }
    catch {
        try {
            _require("hnswlib-node");
            vector = true;
        }
        catch {
            vector = false;
        }
    }
    // LLM: check for openai or compatible client
    let llm = false;
    try {
        _require("openai");
        llm = true;
    }
    catch {
        llm = false;
    }
    // Cloud sync: check for common cloud SDKs
    let cloudSync = false;
    const cloudModules = ["aws-sdk", "@aws-sdk/client-s3", "webdav", "ssh2", "smb2"];
    for (const mod of cloudModules) {
        try {
            _require(mod);
            cloudSync = true;
            break;
        }
        catch {
            // continue
        }
    }
    const matrix = {
        fts5,
        vector,
        llm,
        cloudSync,
        nodeVersion,
        platform,
    };
    logger?.info?.(`[yaoyao-memory:env] Capability matrix — FTS5:${fts5 ? "✅" : "❌"} Vec:${vector ? "✅" : "❌"} LLM:${llm ? "✅" : "❌"} Cloud:${cloudSync ? "✅" : "❌"} Node:${nodeVersion} Platform:${platform}`);
    return matrix;
}
/** Adaptive registration helper: skip features when dependencies are missing */
export function shouldRegisterFeature(featureName, required, matrix, logger) {
    const missing = required.filter((cap) => !matrix[cap]);
    if (missing.length > 0) {
        logger?.warn?.(`[yaoyao-memory:env] Skipping ${featureName} — missing: ${missing.join(", ")}`);
        return false;
    }
    return true;
}
/** Check if this appears to be the first install (no .yaoyao.db yet). */
export function isFirstInstall(baseDir) {
    const dbPath = path.join(baseDir, ".yaoyao.db");
    return !fs.existsSync(dbPath);
}
export { scanEmbeddingSources, generateSetupGuide } from "./env-scan-embed.js";
