/**
 * Memory store — core storage abstraction.
 * Wraps the OpenClaw workspace memory/ directory with file I/O.
 * 
 * Security hardening (v1.5.1+):
 *   - baseDir 创建时权限 0o700（仅 owner 可访问）
 *   - memoryDir 配置禁止 .. 和相对路径
 *   - daily 文件写入后 chmod 0o600
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";

/**
 * Full configuration type that matches plugin's actual consumption.
 * Fields are consumed by: index.ts, auto-capture, auto-recall,
 * memory-cleaner, embedding, LLM client, cloud-adapter, db-bridge.
 */
export interface YaoyaoMemoryConfig {
  capture?: {
    enabled?: boolean;
  };
  recall?: {
    enabled?: boolean;
    maxResults?: number;
  };
  memoryDir?: string;
  embedding?: {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    dimensions?: number;
    provider?: string;
    providerModels?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    maxInputChars?: number;
    backoffBaseMs?: number;
  };
  llm?: {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  cleanup?: {
    enabled?: boolean;
    l0l1RetentionDays?: number;
    allowAggressiveCleanup?: boolean;
  };
  tz?: string; // timezone for date formatting (e.g., "Asia/Shanghai")
  blockLabels?: string[];
  [key: string]: unknown; // allow additional fields
}

/** Validate memoryDir config to prevent path traversal */
function validateMemoryDir(rawDir: string | undefined): string {
  if (!rawDir) {
    return path.join(os.homedir(), ".openclaw", "workspace", "memory");
  }
  const resolved = path.resolve(rawDir);
  // Reject parent directory references
  if (rawDir.includes("..") || !path.isAbsolute(resolved)) {
    throw new Error(`Invalid memoryDir "${rawDir}": must be absolute and not contain parent references`);
  }
  return resolved;
}

export interface MemoryEntry {
  type: "daily" | "memory" | "archive";
  path: string;
  filename: string;
  date?: string;
  size: number;
  modified: number;
}

export function createMemoryStore(config: YaoyaoMemoryConfig, logger?: PluginLogger) {
  let baseDir = validateMemoryDir(config.memoryDir);

  const log = (msg: string) => logger?.debug?.(`[yaoyao-memory:store] ${msg}`);

  function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      log(`Created directory: ${dir}`);
    } else {
      try { fs.chmodSync(dir, 0o700); } catch { /* ignore on Windows or restricted fs */ }
    }
  }

  function dailyFilePath(date?: string): string {
    const d = date || new Date().toISOString().slice(0, 10);
    return path.join(baseDir, `${d}.md`);
  }

  function readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  function getDailyFile(date?: string): string {
    const fp = dailyFilePath(date);
    if (!fs.existsSync(fp)) {
      ensureDir(baseDir);
      const d = date || new Date().toISOString().slice(0, 10);
      const header = `# ${d} 记忆\n\n> 每日对话记录\n\n---\n\n_此文件由 yaoyao-memory 插件自动维护_\n`;
      fs.writeFileSync(fp, header, "utf-8");
      try { fs.chmodSync(fp, 0o600); } catch { /* ignore on Windows */ }
      log(`Created daily file: ${fp}`);
    }
    return fp;
  }

  /** Append content to a daily log file. Creates the file if it doesn't exist. */
  function appendToDaily(date: string | undefined, content: string): void {
    const fp = getDailyFile(date);
    fs.appendFileSync(fp, content, "utf-8");
    try { fs.chmodSync(fp, 0o600); } catch { /* ignore on Windows */ }
  }

  /** List all memory files in the directory. */
  function listFiles(): MemoryEntry[] {
    ensureDir(baseDir);
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md"));
    const results: MemoryEntry[] = [];

    for (const f of files) {
      const fp = path.join(baseDir, f);
      try {
        const stat = fs.statSync(fp);
        let type: MemoryEntry["type"] = "memory";
        if (/^\d{4}-\d{2}-\d{2}/.test(f)) type = "daily";
        else if (f.startsWith("archive") || f.includes("archive")) type = "archive";

        results.push({
          type,
          path: fp,
          filename: f,
          date: /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : undefined,
          size: stat.size,
          modified: stat.mtimeMs,
        });
      } catch {
        // skip unreadable
      }
    }

    results.sort((a, b) => b.modified - a.modified);
    return results;
  }

  return {
    baseDir,
    ensureDir,
    getDailyFile,
    appendToDaily,
    readFile,
    listFiles,
    dailyFilePath,
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
