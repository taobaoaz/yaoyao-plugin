/**
 * features/unify/tool.ts — memory_unify tool (modular).
 */

import { withErrorHandling } from "../../tools/common.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCompatDB } from "../../platform/db/compat.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";

function getOpenClawMemoryDir() {
  return path.join(os.homedir(), ".openclaw", "memory");
}

import type { SQLiteRow } from "../../platform/db/types.ts";

function queryOpenClawDB(sql: string, params?: unknown[]): SQLiteRow[] | null {
  const dbPath = path.join(getOpenClawMemoryDir(), "main.sqlite");
  try { if (!fs.existsSync(dbPath)) return null; } catch { return null; }
  let dbInstance: import("../../platform/db/types.js").UnifiedDB | null = null;
  try {
    const { db } = createCompatDB(dbPath);
    dbInstance = db;
    const rows = db.prepare(sql).all(...(params || []));
    db.close();
    return rows as SQLiteRow[];
  } catch {
    if (dbInstance) {
      try { dbInstance.close(); } catch { /* ignore */ }
    }
    return null;
  }
}

function readDreams(memoryDir: string) {
  const result = { events: [] as unknown[], shortTermRecall: null as unknown };
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
      try {
        result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, "utf8"));
      } catch {
        result.shortTermRecall = [];
      }
    }
  } catch { /* best effort */ }
  return result;
}

export function createUnifyTool(store: MemoryStore): ToolRegistration {
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
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action);
      if (action === "status") return handleStatus(store);
      if (action === "backends") return handleBackends(store);
      if (action === "search_all") return handleSearchAll(store, String(params.query || ""));
      return { content: [{ type: "text", text: "❌ 未知操作。支持: status, search_all, backends" }] };
    }),
  };
}

async function handleStatus(store: MemoryStore) {
  const lines = ["# 🔗 统一记忆状态面板", ""];

  const ocFiles = queryOpenClawDB("SELECT COUNT(*) as c FROM files");
  const ocChunks = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks");
  const ocFts = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks_fts");
  const ocFileCount = ocFiles ? Number(ocFiles[0].c) : 0;
  const ocChunkCount = ocChunks ? Number(ocChunks[0].c) : 0;
  const ocFtsCount = ocFts ? Number(ocFts[0].c) : 0;
  const ocDbPath = path.join(getOpenClawMemoryDir(), "main.sqlite");
  const ocDbSize = fs.existsSync(ocDbPath) ? (fs.statSync(ocDbPath).size / 1024).toFixed(1) : "N/A";

  lines.push("## 📦 OpenClaw 内置记忆");
  lines.push(`- 状态: ${ocFileCount > 0 ? "✅ 活跃" : "⚪ 无数据"}`);
  lines.push(`- 索引文件: ${ocFileCount} 个`);
  lines.push(`- 文本块: ${ocChunkCount} 条`);
  lines.push(`- FTS5 条目: ${ocFtsCount} 条`);
  lines.push(`- 数据库大小: ${ocDbSize} KB`);

  const memoryDir = store.baseDir;
  const dreams = readDreams(memoryDir);
  lines.push("", "## 💭 .dreams 短期记忆");
  lines.push(`- 状态: ${dreams.events.length > 0 ? "✅ 活跃" : "⚪ 无数据"}`);
  lines.push(`- 最近事件: ${dreams.events.length} 条`);
  lines.push(`- 短期召回: ${dreams.shortTermRecall ? "✅ 有数据" : "⚪ 无"}`);

  const yaoDbPath = path.join(memoryDir, ".yaoyao.db");
  const yaoDbSize = fs.existsSync(yaoDbPath) ? (fs.statSync(yaoDbPath).size / 1024).toFixed(1) : "N/A";
  lines.push("", "## 🎲 Yaoyao Memory");
  lines.push(`- 数据库: ${fs.existsSync(yaoDbPath) ? "✅ 活跃" : "⚪ 未初始化"}`);
  lines.push(`- 数据库大小: ${yaoDbSize} KB`);

  const dailyFiles = fs.existsSync(memoryDir)
    ? fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    : [];
  lines.push(`- 每日日志: ${dailyFiles.length} 天`);

  lines.push("", "## 📊 总览");
  const totalBackends = (ocFileCount > 0 ? 1 : 0) + (dreams.events.length > 0 ? 1 : 0) + 1;
  lines.push(`- 活跃后端: ${totalBackends}/3`);
  lines.push(`- 共享文件: memory/*.md（所有后端共同索引）`);
  lines.push(`- 统一管理: yaoyao-memory 作为统一记忆管理层`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleBackends(store: MemoryStore) {
  const lines = ["# 🔍 记忆后端详情", ""];

  lines.push("## 1. OpenClaw 内置记忆 (main.sqlite)");
  const files = queryOpenClawDB("SELECT path, source, size FROM files");
  if (files && files.length > 0) {
    lines.push("", "| 文件 | 来源 | 大小 |", "|------|------|------|");
    files.forEach((f: Record<string, unknown>) => {
      lines.push(`| ${f.path} | ${f.source} | ${(Number(f.size || 0) / 1024).toFixed(1)} KB |`);
    });
  } else {
    lines.push("- 无索引文件");
  }
  lines.push("", "**作用**: OpenClaw 原生文件记忆，通过 `memory-core` 和 `active-memory` 管理");

  lines.push("", "## 2. .dreams 短期召回");
  const memoryDir = store.baseDir;
  const dreams = readDreams(memoryDir);
  if (dreams.events.length > 0) {
    lines.push("", `最近 ${Math.min(dreams.events.length, 5)} 条事件:`);
    dreams.events.slice(-5).forEach((e: Record<string, unknown>) => {
      lines.push(`- [${e.timestamp || e.ts || "?"}] ${e.type || e.event || "?"}: ${String(e.text || JSON.stringify(e)).substring(0, 80)}`);
    });
  } else {
    lines.push("- 无事件");
  }

  lines.push("", "## 3. Yaoyao Memory (.yaoyao.db)");
  lines.push("- FTS5 全文索引 + sqlite-vec 向量搜索");
  lines.push("- 情感分析 + 时间线 + 趋势分析 + 质量评估");
  lines.push("- 云备份 (WebDAV/S3/SFTP/Samba)");
  lines.push("- L1→L2→L3 LLM 提取管线");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleSearchAll(store: MemoryStore, query: string) {
  if (!query || query.length < 2) {
    return { content: [{ type: "text", text: "❌ 搜索关键词至少 2 个字符" }] };
  }

  const lines = [`# 🔍 跨后端搜索: "${query}"`, ""];

  const ocResults = queryOpenClawDB(
    "SELECT path, text FROM chunks_fts WHERE text MATCH ? LIMIT 5",
    [query]
  );
  lines.push("## OpenClaw 内置记忆");
  if (ocResults && ocResults.length > 0) {
    ocResults.forEach((r: Record<string, unknown>) => {
      lines.push(`- **${r.path}**: ${String(r.text).substring(0, 100)}...`);
    });
  } else {
    lines.push("- 无匹配");
  }

  lines.push("", "## Yaoyao Memory");
  lines.push("_使用 memory_search 工具搜索 yaoyao 索引_");

  const memoryDir = store.baseDir;
  const dreams = readDreams(memoryDir);
  lines.push("", "## .dreams 事件");
  const dreamMatches = dreams.events.filter((e: Record<string, unknown>) => {
    const text = JSON.stringify(e);
    return text.toLowerCase().includes(query.toLowerCase());
  });
  if (dreamMatches.length > 0) {
    dreamMatches.slice(0, 5).forEach((e: Record<string, unknown>) => {
      lines.push(`- ${(JSON.stringify(e)).substring(0, 120)}`);
    });
  } else {
    lines.push("- 无匹配");
  }

  lines.push("", "---");
  lines.push(`共找到: OpenClaw=${ocResults ? ocResults.length : 0}, .dreams=${dreamMatches.length}`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
