/**
 * features/retain/tool.ts — memory_retain tool (modular).
 */

import type { ToolRegistration } from "../../tools/common.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";
import type { DBBridge } from "../../utils/db-bridge.ts";
import { withErrorHandling } from "../../tools/common.ts";
import fs from "node:fs";
import path from "node:path";
import {
  detectAtRisk,
  formatRetainCheck,
  formatBoostResult,
  formatImportantResult,
  type BoostRecord,
  type ImportantTag,
  type MemoryItem,
} from "../../core/retain/retain.ts";

function pipelineDir(): string {
  return ".pipeline";
}

function boostFilePath(baseDir: string): string {
  return path.join(baseDir, pipelineDir(), ".retain-boost.jsonl");
}

function importantTagsFilePath(baseDir: string): string {
  return path.join(baseDir, pipelineDir(), ".important-tags.json");
}

function ensurePipelineDir(baseDir: string): void {
  const d = path.join(baseDir, pipelineDir());
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function loadBoostRecords(baseDir: string): BoostRecord[] {
  const fp = boostFilePath(baseDir);
  const records: BoostRecord[] = [];
  try {
    if (!fs.existsSync(fp)) return records;
    const raw = fs.readFileSync(fp, "utf-8");
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        try {
          records.push(JSON.parse(line) as BoostRecord);
        } catch { /* skip malformed line */ }
      } catch { /* skip malformed line */ }
    }
  } catch { /* best effort */ }
  return records;
}

function loadImportantTags(baseDir: string): ImportantTag[] {
  const fp = importantTagsFilePath(baseDir);
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, "utf-8");
    try {
      return JSON.parse(raw) as ImportantTag[];
    } catch {
      return [];
    }
  } catch { return []; }
}

export function createRetainTool(store: MemoryStore, db: DBBridge): ToolRegistration {
  return {
    name: "memory_retain",
    label: "Memory Retain",
    description:
      "🧠 记忆增强/反遗忘 — 检测重要但长期未被召回的记忆，生成强化建议。防止关键记忆被遗忘。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["check", "boost", "important"],
          description: "check=检查遗忘风险, boost=强化指定记忆, important=标记重要记忆",
        },
        keyword: {
          type: "string",
          description: "关键词（action=boost/important 时必填）",
        },
        filename: {
          type: "string",
          description: "文件名（action=boost/important 时可选）",
        },
        reason: {
          type: "string",
          description: "标记原因（action=important 时可选）",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action);

      if (action === "check") {
        return handleCheck(store, db);
      }
      if (action === "boost") {
        const keyword = String(params.keyword || "");
        if (!keyword) {
          return { content: [{ type: "text", text: "❌ action=boost 时 keyword 必填" }] };
        }
        return handleBoost(store, db, keyword, params.filename ? String(params.filename) : undefined, params.reason ? String(params.reason) : undefined);
      }
      if (action === "important") {
        const keyword = String(params.keyword || "");
        if (!keyword) {
          return { content: [{ type: "text", text: "❌ action=important 时 keyword 必填" }] };
        }
        return handleImportant(store, keyword, params.filename ? String(params.filename) : undefined, params.reason ? String(params.reason) : undefined);
      }
      return { content: [{ type: "text", text: `❌ 未知操作: ${action}，支持: check, boost, important` }] };
    }),
  };
}

async function handleCheck(store: MemoryStore, db: DBBridge) {
  const baseDir = store.baseDir;
  const boostRecords = loadBoostRecords(baseDir);
  const importantTags = loadImportantTags(baseDir);

  const allMemories: MemoryItem[] = [];
  try {
    const results = db.search("", 500);
    for (const r of results) {
      const keyword = r.snippet.slice(0, 60).replace(/[^\w\u4e00-\u9fff\s]/g, "").trim() || "untitled";
      allMemories.push({
        keyword,
        filename: r.filename || "unknown",
        snippet: r.snippet.slice(0, 120),
      });
    }
  } catch { /* best effort */ }

  const atRisk = detectAtRisk(allMemories, boostRecords, importantTags, 7);
  const text = formatRetainCheck(allMemories.length, boostRecords.length, importantTags.length, atRisk);

  return { content: [{ type: "text", text }] };
}

async function handleBoost(
  store: MemoryStore,
  db: DBBridge,
  keyword: string,
  filename?: string,
  reason?: string
) {
  const baseDir = store.baseDir;
  ensurePipelineDir(baseDir);

  const record = {
    keyword,
    filename,
    boostedAt: new Date().toISOString(),
    reason,
  };

  try {
    const boostFile = boostFilePath(baseDir);
    fs.appendFileSync(boostFile, JSON.stringify(record) + "\n", "utf-8");
  } catch (err: unknown) {
    return { content: [{ type: "text", text: `❌ 写入强化记录失败: ${(err as Error).message || "未知错误"}` }] };
  }

  let matchedCount = 0;
  try {
    const results = db.search(keyword, 20);
    matchedCount = results.length;
  } catch { /* best effort */ }

  const text = formatBoostResult(keyword, filename, reason, record.boostedAt, matchedCount);
  return { content: [{ type: "text", text }] };
}

async function handleImportant(
  store: MemoryStore,
  keyword: string,
  filename?: string,
  reason?: string
) {
  const baseDir = store.baseDir;
  ensurePipelineDir(baseDir);

  const tags = loadImportantTags(baseDir);
  const alreadyExists = tags.some(
    (t) => t.keyword === keyword && (filename ? t.filename === filename : true),
  );

  if (alreadyExists) {
    return {
      content: [{
        type: "text",
        text: `ℹ️ 该记忆已标记为重要: keyword="${keyword}"${filename ? `, filename="${filename}"` : ""}`,
      }],
    };
  }

  const tag: ImportantTag = {
    keyword,
    filename,
    reason,
    taggedAt: new Date().toISOString(),
  };
  tags.push(tag);

  try {
    const importantFile = importantTagsFilePath(baseDir);
    fs.writeFileSync(importantFile, JSON.stringify(tags, null, 2), "utf-8");
  } catch (err: unknown) {
    return { content: [{ type: "text", text: `❌ 写入重要标签失败: ${(err as Error).message || "未知错误"}` }] };
  }

  const text = formatImportantResult(keyword, filename, reason, tag.taggedAt);
  return { content: [{ type: "text", text }] };
}
