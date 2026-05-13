/**
 * memory_unify — Unified memory management across all OpenClaw memory backends.
 *
 * Provides a single interface to:
 * - Query OpenClaw's built-in memory (main.sqlite chunks/files)
 * - Query .dreams (short-term recall + events)
 * - Query yaoyao's own FTS5 + vec index (.yaoyao.db)
 * - Get a unified status dashboard
 * - Migrate/sync between backends
 *
 * Minimal external deps — only sqlite-vec (via npm); yaoyao backend uses node:sqlite.
 */

import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

function getOpenClawMemoryDir() {
  return path.join(os.homedir(), ".openclaw", "memory");
}

function getWorkspaceMemoryDir(store) {
  return store.baseDir;
}

function queryOpenClawDB(sql: string, params?: any[]) {
  const dbPath = path.join(getOpenClawMemoryDir(), "main.sqlite");
  try { if (!fs.existsSync(dbPath)) return null; } catch { return null; }
  try {
    const db = new DatabaseSync(dbPath, { mode: "readonly" } as any);
    const rows = db.prepare(sql).all(...(params || []));
    db.close();
    return rows as any[];
  } catch {
    return null;
  }
}

function readDreams(memoryDir) {
  const result = { events: [], shortTermRecall: null };
  const eventsPath = path.join(memoryDir, ".dreams", "events.jsonl");
  const recallPath = path.join(memoryDir, ".dreams", "short-term-recall.json");

  try {
    if (fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
      result.events = lines.slice(-20).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  } catch { /* best effort */ }

  try {
    if (fs.existsSync(recallPath)) {
      result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, "utf8"));
    }
  } catch { /* best effort */ }

  return result;
}

export function createUnifyTool(store) {
  return {
    name: "memory_unify",
    label: "Memory Unify",
    description:
      "🔗 统一记忆管理 — 查看 OpenClaw 所有记忆后端的状态，包括内置记忆、yaoyao 索引、.dreams 短期召回",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "search_all", "backends"],
          description: "status=统一状态面板, search_all=跨后端搜索, backends=后端详情",
        },
        query: {
          type: "string",
          description: "搜索关键词（action=search_all 时必填）",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id, params) => {
      const action = String(params.action);

      if (action === "status") {
        return handleStatus(store);
      }
      if (action === "backends") {
        return handleBackends(store);
      }
      if (action === "search_all") {
        return handleSearchAll(store, String(params.query || ""));
      }

      return { content: [{ type: "text", text: "❌ 未知操作。支持: status, search_all, backends" }] };
    }),
  };
}

async function handleStatus(store) {
  const lines = ["# 🔗 统一记忆状态面板", ""];

  // 1. OpenClaw built-in memory
  const ocFiles = queryOpenClawDB("SELECT COUNT(*) as c FROM files");
  const ocChunks = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks");
  const ocFts = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks_fts");

  const ocFileCount = ocFiles ? ocFiles[0].c : 0;
  const ocChunkCount = ocChunks ? ocChunks[0].c : 0;
  const ocFtsCount = ocFts ? ocFts[0].c : 0;
  const ocDbPath = path.join(getOpenClawMemoryDir(), "main.sqlite");
  const ocDbSize = fs.existsSync(ocDbPath) ? (fs.statSync(ocDbPath).size / 1024).toFixed(1) : "N/A";

  lines.push("## 📦 OpenClaw 内置记忆");
  lines.push(`- 状态: ${ocFileCount > 0 ? "✅ 活跃" : "⚪ 无数据"}`);
  lines.push(`- 索引文件: ${ocFileCount} 个`);
  lines.push(`- 文本块: ${ocChunkCount} 条`);
  lines.push(`- FTS5 条目: ${ocFtsCount} 条`);
  lines.push(`- 数据库大小: ${ocDbSize} KB`);

  // 2. .dreams
  const memoryDir = getWorkspaceMemoryDir(store);
  const dreams = readDreams(memoryDir);
  lines.push("", "## 💭 .dreams 短期记忆");
  lines.push(`- 状态: ${dreams.events.length > 0 ? "✅ 活跃" : "⚪ 无数据"}`);
  lines.push(`- 最近事件: ${dreams.events.length} 条`);
  lines.push(`- 短期召回: ${dreams.shortTermRecall ? "✅ 有数据" : "⚪ 无"}`);

  // 3. yaoyao memory
  const yaoDbPath = path.join(memoryDir, ".yaoyao.db");
  const yaoDbSize = fs.existsSync(yaoDbPath) ? (fs.statSync(yaoDbPath).size / 1024).toFixed(1) : "N/A";

  lines.push("", "## 🎲 Yaoyao Memory");
  lines.push(`- 数据库: ${fs.existsSync(yaoDbPath) ? "✅ 活跃" : "⚪ 未初始化"}`);
  lines.push(`- 数据库大小: ${yaoDbSize} KB`);

  // Count daily files
  const dailyFiles = fs.existsSync(memoryDir)
    ? fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    : [];
  lines.push(`- 每日日志: ${dailyFiles.length} 天`);

  // 4. Summary
  lines.push("", "## 📊 总览");
  const totalBackends = (ocFileCount > 0 ? 1 : 0) + (dreams.events.length > 0 ? 1 : 0) + 1;
  lines.push(`- 活跃后端: ${totalBackends}/3`);
  lines.push(`- 共享文件: memory/*.md（所有后端共同索引）`);
  lines.push(`- 统一管理: yaoyao-memory 作为统一记忆管理层`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleBackends(store) {
  const lines = ["# 🔍 记忆后端详情", ""];

  // Backend 1: OpenClaw Built-in
  lines.push("## 1. OpenClaw 内置记忆 (main.sqlite)");
  const files = queryOpenClawDB("SELECT path, source, size FROM files");
  if (files && files.length > 0) {
    lines.push("", "| 文件 | 来源 | 大小 |", "|------|------|------|");
    files.forEach(f => {
      lines.push(`| ${f.path} | ${f.source} | ${((f.size ?? 0) / 1024).toFixed(1)} KB |`);
    });
  } else {
    lines.push("- 无索引文件");
  }
  lines.push("", "**作用**: OpenClaw 原生文件记忆，通过 `memory-core` 和 `active-memory` 管理");

  // Backend 2: .dreams
  lines.push("", "## 2. .dreams 短期召回");
  const memoryDir = getWorkspaceMemoryDir(store);
  const dreams = readDreams(memoryDir);
  if (dreams.events.length > 0) {
    lines.push("", `最近 ${Math.min(dreams.events.length, 5)} 条事件:`);
    dreams.events.slice(-5).forEach(e => {
      lines.push(`- [${e.timestamp || e.ts || "?"}] ${e.type || e.event || "?"}: ${(e.text || e.message || JSON.stringify(e)).substring(0, 80)}`);
    });
  } else {
    lines.push("- 无事件");
  }

  // Backend 3: Yaoyao
  lines.push("", "## 3. Yaoyao Memory (.yaoyao.db)");
  lines.push("- FTS5 全文索引 + sqlite-vec 向量搜索");
  lines.push("- 情感分析 + 时间线 + 趋势分析 + 质量评估");
  lines.push("- 云备份 (WebDAV/S3/SFTP/Samba)");
  lines.push("- L1→L2→L3 LLM 提取管线");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleSearchAll(store, query) {
  if (!query || query.length < 2) {
    return { content: [{ type: "text", text: "❌ 搜索关键词至少 2 个字符" }] };
  }

  const lines = [`# 🔍 跨后端搜索: "${query}"`, ""];

  // Search OpenClaw built-in
  const ocResults = queryOpenClawDB(
    "SELECT path, text FROM chunks_fts WHERE text MATCH ? LIMIT 5",
    [query]
  );
  lines.push("## OpenClaw 内置记忆");
  if (ocResults && ocResults.length > 0) {
    ocResults.forEach(r => {
      lines.push(`- **${r.path}**: ${r.text.substring(0, 100)}...`);
    });
  } else {
    lines.push("- 无匹配");
  }

  // Search yaoyao (via store's existing search)
  lines.push("", "## Yaoyao Memory");
  lines.push("_使用 memory_search 工具搜索 yaoyao 索引_");

  // Search .dreams
  const memoryDir = getWorkspaceMemoryDir(store);
  const dreams = readDreams(memoryDir);
  lines.push("", "## .dreams 事件");
  const dreamMatches = dreams.events.filter(e => {
    const text = JSON.stringify(e);
    return text.toLowerCase().includes(query.toLowerCase());
  });
  if (dreamMatches.length > 0) {
    dreamMatches.slice(0, 5).forEach(e => {
      lines.push(`- ${(JSON.stringify(e)).substring(0, 120)}`);
    });
  } else {
    lines.push("- 无匹配");
  }

  lines.push("", "---");
  lines.push(`共找到: OpenClaw=${ocResults ? ocResults.length : 0}, .dreams=${dreamMatches.length}`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
