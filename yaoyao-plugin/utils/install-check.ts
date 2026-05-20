/**
 * Install-time capability detection — reports what WILL work, never blocks.
 *
 * Philosophy: yaoyao-plugin works on ALL Node.js and ALL OpenClaw versions.
 * The only difference is which backend gets used and which features are available.
 */

import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { readVersionRequirements, satisfiesVersion } from "./version-check.ts";
import { getDBCapability } from "../platform/db/compat.ts";

export interface CapabilityReport {
  canRun: boolean;      // always true — we never refuse
  backend: string;      // node-sqlite | better-sqlite3 | file-db
  features: {
    fts5: boolean;
    wal: boolean;
    vec: boolean;
    autoCapture: boolean;
    autoRecall: boolean;
  };
  warnings: string[];
  info: string[];
}

export function runInstallCheck(): CapabilityReport {
  const warnings: string[] = [];
  const info: string[] = [];
  const versions = readVersionRequirements();
  const dbCap = getDBCapability();

  // 1. Node.js version — report, never block
  const nodeVersion = process.version;
  if (satisfiesVersion(nodeVersion, versions.nodeRange)) {
    info.push(`Node.js ${nodeVersion} ✅ (要求 ${versions.nodeRange})`);
  } else {
    warnings.push(
      `Node.js ${nodeVersion} 低于推荐版本 ${versions.nodeRange}。` +
      `插件将尝试降级模式运行（纯文件系统或 better-sqlite3）。`
    );
  }

  // 2. DB backend detection
  const backend = dbCap.nodeSqliteAvailable
    ? "node-sqlite"
    : dbCap.betterSqlite3Available
    ? "better-sqlite3"
    : "file-db";

  if (backend === "node-sqlite") {
    info.push("SQLite 后端: node:sqlite (Node 22+ 原生) ✅");
  } else if (backend === "better-sqlite3") {
    info.push("SQLite 后端: better-sqlite3 (npm) ✅");
    warnings.push("better-sqlite3 不支持扩展加载，sqlite-vec 向量搜索不可用。");
  } else {
    warnings.push(
      "无 SQLite 可用。插件将运行在纯文件降级模式（file-db）。" +
      "记忆仍会自动保存为 daily markdown，搜索降级为简单文本匹配。" +
      "如需完整功能：npm install better-sqlite3，或升级到 Node 22+。"
    );
  }

  // 3. OpenClaw Gateway version — report, never block
  let gatewayVer = "unknown";
  try {
    const _require = createRequire(import.meta.url);
    const sdk = _require("openclaw/plugin-sdk/plugin-entry");
    gatewayVer = sdk?.OPENCLAW_VERSION || sdk?.version || "unknown";
    if (satisfiesVersion(gatewayVer, versions.pluginApiRange)) {
      info.push(`OpenClaw Gateway ${gatewayVer} ✅ (要求 ${versions.pluginApiRange})`);
    } else {
      warnings.push(
        `OpenClaw Gateway ${gatewayVer} 低于推荐版本 ${versions.pluginApiRange}。` +
        `部分 API 可能不兼容，插件将尝试 graceful fallback。`
      );
    }
  } catch {
    warnings.push(
      `无法检测 OpenClaw Gateway 版本。插件要求 Gateway ${versions.pluginApiRange}。` +
      `如功能异常请升级 Gateway。`
    );
  }

  // 4. sqlite-vec (optional)
  if (backend === "node-sqlite") {
    try {
      const _require = createRequire(import.meta.url);
      _require("sqlite-vec");
      info.push("sqlite-vec 向量扩展已安装 ✅");
    } catch {
      warnings.push(
        "sqlite-vec 未安装。向量搜索不可用，FTS5 纯文本搜索仍正常工作。" +
        "如需向量搜索：npm install sqlite-vec"
      );
    }
  }

  // 5. Temp directory
  try {
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, `.yaoyao-install-test-${Date.now()}`);
    fs.writeFileSync(testFile, "ok", "utf-8");
    fs.unlinkSync(testFile);
    info.push(`临时目录可写: ${tmpDir} ✅`);
  } catch (e: unknown) {
    warnings.push(`临时目录不可写: ${(e as Error).message}。备份、导出功能可能受影响。`);
  }

  // 6. Git
  try {
    execSync("git --version", { stdio: "pipe", timeout: 3_000 });
    info.push("git 可用 ✅");
  } catch {
    warnings.push("git 命令不可用。yaoyao-soul 自动迁移将不可用，需手动安装。");
  }

  return {
    canRun: true, // NEVER false
    backend,
    features: {
      fts5: backend !== "file-db",
      wal: backend !== "file-db",
      vec: backend === "node-sqlite" && (() => { try { const _r = createRequire(import.meta.url); _r("sqlite-vec"); return true; } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] Error: ${msg}`);
      return false;
    } })(),
      autoCapture: true, // always works (writes to daily md)
      autoRecall: backend !== "file-db", // degraded on file-db but still returns something
    },
    warnings,
    info,
  };
}

/** Format capability report */
export function formatInstallCheck(result: CapabilityReport): string {
  const lines = [
    `## 🔧 环境能力报告`,
    ``,
    `**运行模式**: ✅ 可以运行`,
    `**数据库后端**: ${result.backend}`,
    ``,
    `**可用功能**:`,
    `- FTS5 全文搜索: ${result.features.fts5 ? "✅" : "❌（降级为简单文本匹配）"}`,
    `- WAL 模式: ${result.features.wal ? "✅" : "❌"}`,
    `- 向量搜索: ${result.features.vec ? "✅" : "❌"}`,
    `- 自动捕获: ${result.features.autoCapture ? "✅" : "❌"}`,
    `- 自动召回: ${result.features.autoRecall ? "✅" : "⚠️（降级模式）"}`,
    ``,
  ];

  if (result.warnings.length > 0) {
    lines.push(`### ⚠️ 警告`, ``);
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  if (result.info.length > 0) {
    lines.push(`### ℹ️ 信息`, ``);
    for (const i of result.info) lines.push(`- ${i}`);
    lines.push(``);
  }

  return lines.join("\n");
}
