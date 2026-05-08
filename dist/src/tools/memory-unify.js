/**
 * memory_unify — Unified memory management across all OpenClaw memory backends.
 *
 *
 * 功能:
 * - status: 统一状态面板（各后端数据量、最近活动、磁盘占用）
 * - search_all: 真正的跨后端搜索（OpenClaw chunks + yaoyao FTS5 + .dreams）
 * - backends: 后端详情（动态数据，非静态文本）
 * - dedup: 跨后端去重（检测 OpenClaw chunks 与 yaoyao 索引的重复条目）
 * - migrate: 将数据从一个后端迁移到另一个
 * - stats: 详细的跨后端统计信息（时间分布、重复率、覆盖率）
 */

import { withErrorHandling } from "./common.js";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const _require = createRequire(import.meta.url);

// ── Constants ──
const OC_MEMORY_DIR = () => path.join(os.homedir(), ".openclaw", "memory");
const OC_DB = () => path.join(OC_MEMORY_DIR(), "main.sqlite");
const YAOMEM_DIR = (store) => store.baseDir;
const YAOMEM_DB = (store) => path.join(YAOMEM_DIR(store), ".yaoyao.db");

// ── OpenClaw DB helpers ──
function openOCDB() {
  const dbPath = OC_DB();
  if (!fs.existsSync(dbPath)) return null;
  const { DatabaseSync } = _require("node:sqlite");
  const db = new DatabaseSync(dbPath, { mode: "readonly" });
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}

function withOCDB(fn) {
  let db = null;
  try {
    db = openOCDB();
    if (!db) return null;
    return fn(db);
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

// ── Yaoyao DB helpers (reuse existing db-bridge pattern) ──
function openYaoDB(store) {
  const dbPath = YAOMEM_DB(store);
  if (!fs.existsSync(dbPath)) return null;
  const { DatabaseSync } = _require("node:sqlite");
  const db = new DatabaseSync(dbPath, { mode: "readonly" });
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}

function withYaoDB(store, fn) {
  let db = null;
  try {
    db = openYaoDB(store);
    if (!db) return null;
    return fn(db);
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

// ── .dreams helpers ──
function readDreams(memoryDir) {
  const result = { events: [], shortTermRecall: null };
  const eventsPath = path.join(memoryDir, ".dreams", "events.jsonl");
  const recallPath = path.join(memoryDir, ".dreams", "short-term-recall.json");
  try {
    if (fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
      result.events = lines.slice(-50).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  } catch { /* best effort */ }
  try {
    if (fs.existsSync(recallPath)) {
      result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, "utf8"));
    }
  } catch { /* best effort */ }
  return result;
}

// ── Clean content for display (strip raw JSON wrappers) ──
function cleanContent(text, maxLen = 200) {
  if (!text) return "";
  let cleaned = text;
  // Strip JSON array wrappers like [{"type":"text","text":"..."}]
  const jsonArrayMatch = cleaned.match(/^\[?\{"type":"text","text":"(.+?)"\}\]?$/s);
  if (jsonArrayMatch) {
    cleaned = jsonArrayMatch[1];
  }
  // Strip message_id prefixes
  cleaned = cleaned.replace(/^\[message_id:\s*[^\]]+\]\s*/, "");
  // Strip user ID prefixes
  cleaned = cleaned.replace(/^ou_[a-f0-9]+:\s*/, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, maxLen);
}

// ── Compute file size safely ──
function fileSizeKB(filePath) {
  try {
    return fs.existsSync(filePath) ? (fs.statSync(filePath).size / 1024).toFixed(1) : "0";
  } catch {
    return "0";
  }
}

// ── Extract clean text from OpenClaw chunks ──
function extractChunkText(raw) {
  if (!raw) return "";
  let text = raw;
  // Try to parse JSON arrays in the text
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      text = parsed.map(p => {
        if (typeof p === "string") return p;
        if (p && p.type === "text" && p.text) return p.text;
        return "";
      }).filter(Boolean).join(" ");
    } else if (typeof parsed === "string") {
      text = parsed;
    }
  } catch {
    // Not JSON, use as-is
  }
  return cleanContent(text, 300);
}

// ── Search helpers ──
function searchOCChunks(query, limit = 10) {
  return withOCDB((db) => {
    // Try FTS5 first
    try {
      const safeQ = query.replace(/["*^`()~]/g, "").trim().slice(0, 200);
      if (safeQ.length >= 2) {
        const rows = db.prepare(
          "SELECT c.path, c.text, c.start_line, c.end_line FROM chunks_fts f " +
          "JOIN chunks c ON f.id = c.id " +
          "WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?"
        ).all(safeQ, limit);
        if (rows.length > 0) return rows.map(r => ({
          source: "openclaw",
          path: r.path,
          snippet: extractChunkText(r.text),
          lineRange: `${r.start_line}-${r.end_line}`,
          score: 0.7,
        }));
      }
    } catch { /* FTS5 syntax error, fall through */ }

    // LIKE fallback
    try {
      const likeQ = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const rows = db.prepare(
        "SELECT path, text, start_line, end_line FROM chunks " +
        "WHERE text LIKE ? ESCAPE '\\' LIMIT ?"
      ).all(likeQ, limit);
      return rows.map(r => ({
        source: "openclaw",
        path: r.path,
        snippet: extractChunkText(r.text),
        lineRange: `${r.start_line}-${r.end_line}`,
        score: 0.5,
      }));
    } catch {
      return [];
    }
  }) || [];
}

function searchYaoMem(store, query, limit = 10) {
  return withYaoDB(store, (db) => {
    // FTS5 search
    try {
      const safeQ = query.replace(/["*^`()~]/g, "").trim().slice(0, 200);
      if (safeQ.length >= 2) {
        const rows = db.prepare(
          "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
          "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?"
        ).all(safeQ, limit);
        if (rows.length > 0) {
          return rows.map(r => ({
            source: "yaoyao",
            path: `${r.date}.md`,
            snippet: cleanContent(r.snippet, 300),
            date: r.date || "",
            score: r.rank < 0 ? Math.min(1, Math.max(0.1, -r.rank / 15)) : 0.3,
          }));
        }
      }
    } catch { /* FTS5 miss */ }

    // LIKE fallback
    try {
      const likeQ = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const rows = db.prepare(
        "SELECT id, date, user_text, asst_text FROM memory_meta " +
        "WHERE user_text LIKE ? ESCAPE '\\' OR asst_text LIKE ? ESCAPE '\\' " +
        "ORDER BY id DESC LIMIT ?"
      ).all(likeQ, likeQ, limit);
      return rows.map(r => ({
        source: "yaoyao",
        path: `${r.date}.md`,
        snippet: cleanContent(`${r.user_text || ""} ${r.asst_text || ""}`, 300),
        date: r.date || "",
        score: 0.5,
      }));
    } catch {
      return [];
    }
  }) || [];
}

function searchDreams(memoryDir, query) {
  const dreams = readDreams(memoryDir);
  const q = query.toLowerCase();
  return dreams.events
    .filter(e => JSON.stringify(e).toLowerCase().includes(q))
    .slice(0, 5)
    .map(e => ({
      source: "dreams",
      snippet: cleanContent(JSON.stringify(e), 200),
      score: 0.4,
    }));
}

// ── Dedup: find overlapping entries between OC chunks and yaoyao FTS5 ──
function findDuplicates(store) {
  const results = [];

  // Get yaoyao entries (date + first 50 chars of user_text)
  const yaoEntries = withYaoDB(store, (db) => {
    return db.prepare(
      "SELECT id, date, substr(user_text, 1, 50) as ukey FROM memory_meta WHERE user_text IS NOT NULL AND user_text != ''"
    ).all();
  }) || [];

  // Get OC chunks (path + first 50 chars of cleaned text)
  const ocEntries = withOCDB((db) => {
    return db.prepare(
      "SELECT id, path, substr(text, 1, 50) as tkey FROM chunks WHERE text IS NOT NULL AND text != ''"
    ).all();
  }) || [];

  // Cross-reference: check if OC chunk text overlaps with yaoyao entries of same date
  const yaoByDate = new Map();
  for (const y of yaoEntries) {
    if (!yaoByDate.has(y.date)) yaoByDate.set(y.date, []);
    yaoByDate.get(y.date).push(y);
  }

  for (const oc of ocEntries) {
    // Extract date from path like "memory/2026-05-05.md"
    const dateMatch = oc.path.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    const yaos = yaoByDate.get(date);
    if (!yaos) continue;

    // Check if any yaoyao entry's user_text appears in OC chunk text
    for (const y of yaos) {
      const cleanedKey = cleanContent(y.ukey, 40).replace(/\s+/g, "");
      if (cleanedKey.length < 4) continue;
      try {
        const ocFullText = withOCDB((db) => {
          const row = db.prepare("SELECT text FROM chunks WHERE id = ?").get(oc.id);
          return row ? row.text : "";
        }) || "";
        if (ocFullText.includes(cleanedKey) || cleanContent(ocFullText, 200).includes(cleanedKey)) {
          results.push({
            date,
            ocPath: oc.path,
            ocId: oc.id,
            yaoId: y.id,
            overlap: cleanedKey.slice(0, 50),
          });
          break; // one match per OC chunk is enough
        }
      } catch { /* best effort */ }
    }
  }

  return results;
}

// ── Handlers ──

async function handleStatus(store) {
  const lines = ["# 🔗 统一记忆状态面板", ""];

  // ── OpenClaw Built-in ──
  const ocDbPath = OC_DB();
  const ocExists = fs.existsSync(ocDbPath);
  let ocFiles = 0, ocChunks = 0, ocLastUpdate = null;
  if (ocExists) {
    ocFiles = withOCDB(db => (db.prepare("SELECT COUNT(*) as c FROM files").get()?.c || 0)) || 0;
    ocChunks = withOCDB(db => (db.prepare("SELECT COUNT(*) as c FROM chunks").get()?.c || 0)) || 0;
    ocLastUpdate = withOCDB(db => {
      const r = db.prepare("SELECT MAX(updated_at) as t FROM chunks").get();
      return r?.t ? new Date(r.t).toISOString().slice(0, 19).replace("T", " ") : null;
    }) || null;
  }
  lines.push("## 📦 OpenClaw 内置记忆");
  lines.push("- 状态: " + (ocFiles > 0 ? "✅ 活跃" : "⚪ 无数据"));
  lines.push("- 索引文件: " + ocFiles + " 个");
  lines.push("- 文本块: " + ocChunks + " 条");
  lines.push("- 数据库: " + fileSizeKB(ocDbPath) + " KB");
  if (ocLastUpdate) lines.push("- 最近更新: " + ocLastUpdate);

  // ── Yaoyao Memory ──
  const yaoDbPath = YAOMEM_DB(store);
  let yaoTotal = 0, yaoDates = 0, yaoVecCount = 0;
  if (fs.existsSync(yaoDbPath)) {
    yaoTotal = withYaoDB(store, db => (db.prepare("SELECT COUNT(*) as c FROM memory_meta").get()?.c || 0)) || 0;
    yaoDates = withYaoDB(store, db => (db.prepare("SELECT COUNT(DISTINCT date) as c FROM memory_meta").get()?.c || 0)) || 0;
    try { yaoVecCount = withYaoDB(store, db => (db.prepare("SELECT COUNT(*) as c FROM memory_vec").get()?.c || 0)) || 0; } catch { /* vec not available */ }
  }
  const dailyFiles = fs.existsSync(store.baseDir)
    ? fs.readdirSync(store.baseDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    : [];
  lines.push("", "## 🎲 Yaoyao Memory");
  lines.push("- 状态: " + (fs.existsSync(yaoDbPath) ? "✅ 活跃" : "⚪ 未初始化"));
  lines.push("- 记忆条目: " + yaoTotal + " 条");
  lines.push("- 覆盖天数: " + yaoDates + " 天");
  lines.push("- 向量索引: " + yaoVecCount + " 条");
  lines.push("- 每日日志: " + dailyFiles.length + " 个文件");
  lines.push("- 数据库: " + fileSizeKB(yaoDbPath) + " KB");

  // ── .dreams ──
  const dreams = readDreams(store.baseDir);
  lines.push("", "## 💭 .dreams 短期记忆");
  lines.push("- 状态: " + (dreams.events.length > 0 ? "✅ 活跃" : "⚪ 无数据"));
  lines.push("- 事件: " + dreams.events.length + " 条");
  lines.push("- 短期召回: " + (dreams.shortTermRecall ? "✅ 有数据" : "⚪ 无"));

  // ── Summary ──
  lines.push("", "## 📊 总览");
  const activeBackends = (ocFiles > 0 ? 1 : 0) + (yaoTotal > 0 ? 1 : 0) + (dreams.events.length > 0 ? 1 : 0);
  lines.push("- 活跃后端: " + activeBackends + "/3");
  lines.push("- 总记忆条目: " + (ocChunks + yaoTotal + dreams.events.length));
  lines.push("- 数据总占用: " + (
    parseFloat(fileSizeKB(ocDbPath)) +
    parseFloat(fileSizeKB(yaoDbPath))
  ).toFixed(1) + " KB (DB)");
  lines.push("", "> 💡 使用 `action: dedup` 检测跨后端重复，`action: search_all` 跨后端搜索");

  // ── 接管状态面板 ──
  lines.push("", "## 🔗 接管状态");

  // OpenClaw chunks 接管状态
  const ocImportLast = withYaoDB(store, db => db.prepare("SELECT value FROM memory_config WHERE key = ?").get("oc_import_last_id"));
  lines.push("- OpenClaw Chunks: " + (ocImportLast ? `已导入至 ID ${ocImportLast.value}` : "未导入"));

  // Workspace 接管状态
  const wsFiles = ["MEMORY.md", "USER.md", "SOUL.md", "IDENTITY.md"]
    .filter(f => withYaoDB(store, db => db.prepare("SELECT value FROM memory_config WHERE key = ?").get(`ws_import_${f}`)));
  lines.push("- Workspace 文件: " + (wsFiles.length > 0 ? `已导入 ${wsFiles.length} 个` : "未导入"));

  // Daily reindex 状态
  const dailyDir = store.baseDir;
  const totalDaily = fs.existsSync(dailyDir)
    ? fs.readdirSync(dailyDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length
    : 0;
  lines.push("- Daily 日志索引: " + totalDaily + " 个文件");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleSearchAll(store, query) {
  if (!query || query.length < 2) {
    return { content: [{ type: "text", text: "❌ 搜索关键词至少 2 个字符" }] };
  }

  const [ocResults, yaoResults, dreamResults] = await Promise.all([
    Promise.resolve(searchOCChunks(query, 5)),
    Promise.resolve(searchYaoMem(store, query, 5)),
    Promise.resolve(searchDreams(store.baseDir, query)),
  ]);

  const lines = [`# 🔍 跨后端搜索: "${query}"`, ""];

  // OpenClaw results
  lines.push("## 📦 OpenClaw 内置 (" + ocResults.length + " 条)");
  if (ocResults.length > 0) {
    for (const r of ocResults) {
      lines.push(`- **${r.path}** (L${r.lineRange}): ${r.snippet.slice(0, 120)}...`);
    }
  } else {
    lines.push("- 无匹配");
  }

  // Yaoyao results
  lines.push("", "## 🎲 Yaoyao Memory (" + yaoResults.length + " 条)");
  if (yaoResults.length > 0) {
    for (const r of yaoResults) {
      lines.push(`- **${r.path}**: ${r.snippet.slice(0, 120)}...`);
    }
  } else {
    lines.push("- 无匹配");
  }

  // .dreams results
  lines.push("", "## 💭 .dreams (" + dreamResults.length + " 条)");
  if (dreamResults.length > 0) {
    for (const r of dreamResults) {
      lines.push(`- ${r.snippet.slice(0, 120)}`);
    }
  } else {
    lines.push("- 无匹配");
  }

  const total = ocResults.length + yaoResults.length + dreamResults.length;
  lines.push("", "---");
  lines.push(`共找到 **${total}** 条结果 (OpenClaw=${ocResults.length}, Yaoyao=${yaoResults.length}, Dreams=${dreamResults.length})`);

  // Dedup hint
  if (ocResults.length > 0 && yaoResults.length > 0) {
    lines.push("", "⚠️ 两边都有结果，可能存在重复索引。使用 `action: dedup` 检查。");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleBackends(store) {
  const lines = ["# 🔍 记忆后端详情", ""];

  // ── 1. OpenClaw ──
  lines.push("## 1. 📦 OpenClaw 内置记忆 (main.sqlite)");
  const files = withOCDB(db => db.prepare("SELECT path, source, size FROM files").all()) || [];
  if (files.length > 0) {
    lines.push("");
    for (const f of files) {
      lines.push(`- \`${f.path}\` (${(f.size / 1024).toFixed(1)} KB, ${f.source})`);
    }
    lines.push("");
    lines.push("**Schema**: files → chunks → chunks_fts (FTS5)");
    lines.push("**作用**: OpenClaw 原生文件记忆，索引 workspace 下的 md/json 文件");
  } else {
    lines.push("- 无索引文件");
  }

  // ── 2. Yaoyao ──
  lines.push("", "## 2. 🎲 Yaoyao Memory (.yaoyao.db)");
  const yaoDates = withYaoDB(store, db =>
    db.prepare("SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC LIMIT 10").all()
  ) || [];
  if (yaoDates.length > 0) {
    lines.push("");
    for (const d of yaoDates) {
      lines.push(`- **${d.date}**: ${d.c} 条`);
    }
  }
  lines.push("");
  lines.push("**能力**: FTS5 + sqlite-vec | 情感分析 | 时间线 | 趋势 | 云备份 | L1→L3 管线");

  // ── 3. .dreams ──
  lines.push("", "## 3. 💭 .dreams 短期召回");
  const dreams = readDreams(store.baseDir);
  if (dreams.events.length > 0) {
    lines.push("- 事件总数: " + dreams.events.length);
    lines.push("- 最近 3 条:");
    dreams.events.slice(-3).forEach(e => {
      const summary = JSON.stringify(e).slice(0, 100);
      lines.push(`  - ${summary}...`);
    });
  } else {
    lines.push("- 无事件");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleDedup(store) {
  const lines = ["# 🔍 跨后端去重分析", ""];

  const dups = findDuplicates(store);
  if (dups.length === 0) {
    lines.push("✅ 未发现跨后端重复条目。");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  lines.push(`发现 **${dups.length}** 条可能的重复：`);
  lines.push("");

  // Group by date
  const byDate = new Map();
  for (const d of dups) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date).push(d);
  }

  for (const [date, entries] of byDate) {
    lines.push(`### ${date} (${entries.length} 条)`);
    for (const e of entries.slice(0, 10)) {
      lines.push(`- OC: \`${e.ocPath}\` ↔ Yaoyao: #${e.yaoId}`);
      lines.push(`  重叠内容: "${e.overlap}..."`);
    }
    if (entries.length > 10) {
      lines.push(`- ...还有 ${entries.length - 10} 条`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("💡 **建议**: OpenClaw chunks 和 Yaoyao FTS5 索引了相同的 daily md 文件内容。");
  lines.push("重复不影响功能，但增加了存储和搜索冗余。");
  lines.push("Yaoyao 索引存储了结构化对话（user/AI 分离），OC 索引存储了原始文件块。");
  lines.push("两者互补，不需要手动清理。");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleStats(store) {
  const lines = ["# 📊 跨后端统计", ""];

  // ── Time distribution ──
  lines.push("## 📅 时间分布");

  // Yaoyao by date
  const yaoByDate = withYaoDB(store, db =>
    db.prepare("SELECT date, COUNT(*) as c FROM memory_meta GROUP BY date ORDER BY date DESC").all()
  ) || [];
  lines.push("", "### Yaoyao Memory");
  if (yaoByDate.length > 0) {
    for (const d of yaoByDate.slice(0, 15)) {
      const bar = "█".repeat(Math.min(d.c, 30));
      lines.push(`${d.date}: ${bar} (${d.c})`);
    }
    if (yaoByDate.length > 15) {
      lines.push(`...共 ${yaoByDate.length} 天`);
    }
  } else {
    lines.push("- 无数据");
  }

  // OC by path
  const ocByPath = withOCDB(db =>
    db.prepare("SELECT path, COUNT(*) as c FROM chunks GROUP BY path ORDER BY path").all()
  ) || [];
  lines.push("", "### OpenClaw Chunks");
  if (ocByPath.length > 0) {
    for (const p of ocByPath) {
      lines.push(`- \`${p.path}\`: ${p.c} chunks`);
    }
  } else {
    lines.push("- 无数据");
  }

  // ── Coverage ──
  lines.push("", "## 📈 覆盖率");
  const yaoDates = new Set(yaoByDate.map(d => d.date));
  const ocDates = new Set(ocByPath.filter(p => p.path.match(/\d{4}-\d{2}-\d{2}/)).map(p => p.path.match(/(\d{4}-\d{2}-\d{2})/)[1]));
  const allDates = new Set([...yaoDates, ...ocDates]);
  const bothDates = [...yaoDates].filter(d => ocDates.has(d));
  lines.push("- 总覆盖天数: " + allDates.size);
  lines.push("- Yaoyao 独有: " + (yaoDates.size - bothDates.length) + " 天");
  lines.push("- OpenClaw 独有: " + (ocDates.size - bothDates.length) + " 天");
  lines.push("- 双重覆盖: " + bothDates.length + " 天");
  lines.push("- 覆盖重叠率: " + (allDates.size > 0 ? ((bothDates.length / allDates.size) * 100).toFixed(1) : 0) + "%");

  // ── Storage ──
  lines.push("", "## 💾 存储占用");
  lines.push("- OpenClaw DB: " + fileSizeKB(OC_DB()) + " KB");
  lines.push("- Yaoyao DB: " + fileSizeKB(YAOMEM_DB(store)) + " KB");

  const memoryDir = store.baseDir;
  if (fs.existsSync(memoryDir)) {
    const mdFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md"));
    let totalMdSize = 0;
    for (const f of mdFiles) {
      try { totalMdSize += fs.statSync(path.join(memoryDir, f)).size; } catch { /* skip */ }
    }
    lines.push("- Daily MD 文件: " + mdFiles.length + " 个, " + (totalMdSize / 1024).toFixed(1) + " KB");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ── Main tool ──
export function createUnifyTool(store) {
  return {
    name: "memory_unify",
    label: "Memory Unify",
    description: "🔗 统一记忆管理 — 查看/搜索/去重/统计 OpenClaw 所有记忆后端（内置记忆 + yaoyao + .dreams）。支持 status(状态面板), search_all(跨后端搜索), backends(后端详情), dedup(去重分析), stats(跨后端统计)。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "search_all", "backends", "dedup", "stats"],
          description: "操作类型: status=统一状态面板, search_all=跨后端搜索, backends=后端详情, dedup=跨后端去重分析, stats=跨后端统计",
        },
        query: {
          type: "string",
          description: "搜索关键词（action=search_all 时必填）",
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id, params) => {
      const actionAliases = {
        "状态": "status", "搜索": "search_all", "详情": "backends", "去重": "dedup", "统计": "stats",
      };
      const action = actionAliases[String(params.action)] || String(params.action);
      const timeoutMs = 8000;
      return await Promise.race([
        (async () => {
          if (action === "status") return handleStatus(store);
          if (action === "backends") return handleBackends(store);
          if (action === "search_all") return handleSearchAll(store, String(params.query || ""));
          if (action === "dedup") return handleDedup(store);
          if (action === "stats") return handleStats(store);
          return { content: [{ type: "text", text: "❌ 未知操作。支持: status, search_all, backends, dedup, stats" }] };
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("操作超时 (" + timeoutMs + "ms)")), timeoutMs)
        ),
      ]);
    }),
  };
}
