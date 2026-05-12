/**
 * Memory Retain Tool — 记忆增强/反遗忘
 *
 * Detects important but long-unrecalled memories, generates reinforcement suggestions.
 * Prevents key memory loss by tracking recall history and importance tags.
 * Minimal external deps — only sqlite-vec (via npm); core logic uses node:fs, path.
 */
import type { ToolRegistration } from "./common.js";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";

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
        const filename = params.filename ? String(params.filename) : undefined;
        const reason = params.reason ? String(params.reason) : undefined;
        return handleBoost(store, db, keyword, filename, reason);
      }

      if (action === "important") {
        const keyword = String(params.keyword || "");
        if (!keyword) {
          return { content: [{ type: "text", text: "❌ action=important 时 keyword 必填" }] };
        }
        const filename = params.filename ? String(params.filename) : undefined;
        const reason = params.reason ? String(params.reason) : undefined;
        return handleImportant(store, keyword, filename, reason);
      }

      return { content: [{ type: "text", text: `❌ 未知操作: ${action}，支持: check, boost, important` }] };
    }),
  };
}

// ── Helpers ──

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

interface BoostRecord {
  keyword: string;
  filename?: string;
  boostedAt: string;
  reason?: string;
}

interface ImportantTag {
  keyword: string;
  filename?: string;
  reason?: string;
  taggedAt: string;
}

// ── Action: check ──

async function handleCheck(
  store: MemoryStore,
  db: DBBridge,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;

  // 1. Load boost history
  const boostRecords: BoostRecord[] = loadBoostRecords(baseDir);

  // 2. Load important tags
  const importantTags: ImportantTag[] = loadImportantTags(baseDir);

  // 3. Search all memories from FTS5
  let allMemories: Array<{ keyword: string; filename: string; snippet: string }> = [];
  try {
    const results = db.search("", 500);
    for (const r of results) {
      // Extract a simple keyword from snippet (first few meaningful chars)
      const keyword = r.snippet.slice(0, 60).replace(/[^\w\u4e00-\u9fff\s]/g, "").trim() || "untitled";
      allMemories.push({
        keyword,
        filename: r.filename || "unknown",
        snippet: r.snippet.slice(0, 120),
      });
    }
  } catch {
    /* best effort */
  }

  // 4. Build lookup: last recall time per keyword/filename
  const recallMap = new Map<string, string>(); // key -> lastRecall ISO string
  for (const rec of boostRecords) {
    const key = rec.filename ? `${rec.keyword}::${rec.filename}` : rec.keyword;
    const existing = recallMap.get(key);
    if (!existing || rec.boostedAt > existing) {
      recallMap.set(key, rec.boostedAt);
    }
  }

  // 5. Identify at-risk memories
  const now = Date.now();
  const msDay = 86400000;
  const atRisk: Array<{
    keyword: string;
    filename: string;
    snippet: string;
    lastRecalled: string | null;
    daysSinceRecall: number;
    isImportant: boolean;
  }> = [];

  for (const mem of allMemories) {
    const key = mem.filename ? `${mem.keyword}::${mem.filename}` : mem.keyword;
    const lastRecalled = recallMap.get(key) || null;
    let daysSinceRecall = 9999;
    if (lastRecalled) {
      daysSinceRecall = Math.floor((now - new Date(lastRecalled).getTime()) / msDay);
    } else {
      // Never recalled — still at risk
      daysSinceRecall = 9999;
    }

    const isImportant = importantTags.some(
      (t) =>
        t.keyword === mem.keyword ||
        (t.filename && t.filename === mem.filename),
    );

    // At risk: >7 days since last recall OR never recalled AND is important
    if (daysSinceRecall > 7 || (daysSinceRecall === 9999 && isImportant)) {
      atRisk.push({
        keyword: mem.keyword,
        filename: mem.filename,
        snippet: mem.snippet,
        lastRecalled,
        daysSinceRecall,
        isImportant,
      });
    }
  }

  // Sort: important first, then by days since recall descending
  atRisk.sort((a, b) => {
    if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
    return b.daysSinceRecall - a.daysSinceRecall;
  });

  // 6. Build report
  const lines: string[] = [
    "🧠 **记忆增强/反遗忘检查报告**",
    "",
    `📊 总记忆条目: ${allMemories.length}`,
    `🔍 有强化记录的条目: ${boostRecords.length}`,
    `⭐ 重要标签数: ${importantTags.length}`,
    `⚠️ 遗忘风险条目: ${atRisk.length}`,
    "",
  ];

  if (atRisk.length > 0) {
    lines.push("**遗忘风险列表（超过 7 天未召回）:**");
    lines.push("");
    const maxShow = Math.min(atRisk.length, 20);
    for (let i = 0; i < maxShow; i++) {
      const m = atRisk[i];
      const icon = m.isImportant ? "⭐" : "⚠️";
      const daysStr = m.daysSinceRecall === 9999 ? "从未召回" : `${m.daysSinceRecall} 天`;
      lines.push(
        `${icon} **#${i + 1}** — ${daysStr} 未召回`,
        `   片段: ${m.snippet}`,
        `   文件: ${m.filename}`,
        m.isImportant ? "   💡 重要记忆，建议立即强化" : "",
        "",
      );
    }
    if (atRisk.length > 20) {
      lines.push(`...以及 ${atRisk.length - 20} 条更多遗忘风险记忆`);
      lines.push("");
    }

    lines.push("💡 **建议**:");
    const importantAtRisk = atRisk.filter((m) => m.isImportant);
    if (importantAtRisk.length > 0) {
      lines.push(
        `   • 使用 \`memory_retain(action:boost, keyword: "${importantAtRisk[0].keyword}")\` 强化重要记忆`,
      );
    } else if (atRisk.length > 0) {
      lines.push(
        `   • 先用 \`memory_retain(action:important, keyword: "xxx")\` 标记重要记忆`,
      );
      lines.push(
        `   • 再用 \`memory_retain(action:boost, keyword: "${atRisk[0].keyword}")\` 强化`,
      );
    }
  } else {
    lines.push("✅ **没有发现遗忘风险！** 所有记忆都在 7 天内被召回过。");
    lines.push("");
    lines.push("💡 定期使用 memory_retain(action:check) 可保持记忆新鲜度。");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ── Action: boost ──

async function handleBoost(
  store: MemoryStore,
  db: DBBridge,
  keyword: string,
  filename?: string,
  reason?: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;
  ensurePipelineDir(baseDir);

  const record: BoostRecord = {
    keyword,
    filename,
    boostedAt: new Date().toISOString(),
    reason,
  };

  try {
    const boostFile = boostFilePath(baseDir);
    fs.appendFileSync(boostFile, JSON.stringify(record) + "\n", "utf-8");
  } catch (err: any) {
    return { content: [{ type: "text", text: `❌ 写入强化记录失败: ${err.message || "未知错误"}` }] };
  }

  // Search for matching memories
  let matchedCount = 0;
  try {
    const results = db.search(keyword, 20);
    matchedCount = results.length;
  } catch {
    /* best effort */
  }

  const lines: string[] = [
    "✅ **记忆强化成功**",
    "",
    `**关键词**: ${keyword}`,
    filename ? `**文件**: ${filename}` : null,
    reason ? `**原因**: ${reason}` : null,
    `**时间**: ${record.boostedAt}`,
    `**匹配的记忆条目**: ${matchedCount} 条`,
    "",
    "强化后的记忆将在 auto-recall 中获得更高权重。",
  ].filter(Boolean) as string[];

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ── Action: important ──

async function handleImportant(
  store: MemoryStore,
  keyword: string,
  filename?: string,
  reason?: string,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const baseDir = store.baseDir;
  ensurePipelineDir(baseDir);

  // Load existing tags
  const tags: ImportantTag[] = loadImportantTags(baseDir);

  // Check if already tagged
  const alreadyExists = tags.some(
    (t) => t.keyword === keyword && (filename ? t.filename === filename : true),
  );

  if (alreadyExists) {
    return {
      content: [
        {
          type: "text",
          text: `ℹ️ 该记忆已标记为重要: keyword="${keyword}"${filename ? `, filename="${filename}"` : ""}`,
        },
      ],
    };
  }

  // Add new tag
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
  } catch (err: any) {
    return { content: [{ type: "text", text: `❌ 写入重要标签失败: ${err.message || "未知错误"}` }] };
  }

  const lines: string[] = [
    "⭐ **重要记忆标记成功**",
    "",
    `**关键词**: ${keyword}`,
    filename ? `**文件**: ${filename}` : null,
    reason ? `**原因**: ${reason}` : null,
    `**标记时间**: ${tag.taggedAt}`,
    "",
    "该记忆在 check 中将获得特别标注。",
    "建议随后使用 memory_retain(action:boost, keyword: ...) 强化.",
  ].filter(Boolean) as string[];

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ── File I/O helpers ──

function loadBoostRecords(baseDir: string): BoostRecord[] {
  const fp = boostFilePath(baseDir);
  const records: BoostRecord[] = [];
  try {
    if (!fs.existsSync(fp)) return records;
    const raw = fs.readFileSync(fp, "utf-8");
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        records.push(JSON.parse(line) as BoostRecord);
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* best effort */
  }
  return records;
}

function loadImportantTags(baseDir: string): ImportantTag[] {
  const fp = importantTagsFilePath(baseDir);
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, "utf-8");
    return JSON.parse(raw) as ImportantTag[];
  } catch {
    return [];
  }
}
