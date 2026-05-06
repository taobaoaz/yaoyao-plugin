/**
 * memory_search_enhanced 功能测试（DB 层 + 关键词提取）
 *
 * 测试 FTS5 搜索结合关键词高亮、停用词过滤、搜索结果格式
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enhanced-test-"));

function createDbAndSeed() {
  const dbPath = path.join(tmpDir, ".yaoyao.db");
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
      "date, user_text, asst_text, tokenize='unicode61'" +
    ")"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS memory_meta (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "date TEXT NOT NULL, " +
      "user_text TEXT, " +
      "asst_text TEXT, " +
      "created_at TEXT DEFAULT (datetime('now'))" +
    ")"
  );

  const insertMeta = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
  const entries = [
    { date: "2026-05-01", user: "今天天气不错适合出去散步", asst: "好的" },
    { date: "2026-05-02", user: "完成了项目A的数据库设计", asst: "使用MongoDB" },
    { date: "2026-05-03", user: "研究了机器学习相关算法", asst: "深度学习" },
    { date: "2026-05-04", user: "Search test results for benchmark", asst: "Analysis complete" },
    { date: "2026-05-05", user: "系统性能优化讨论", asst: "建议使用缓存" },
  ];
  for (const e of entries) {
    const r = insertMeta.run(e.date, e.user, e.asst);
    insertFts.run(Number(r.lastInsertRowid), e.date, e.user, e.asst);
  }
  db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
  return db;
}

// Simulate extractKeywords logic (同原文件)
function extractKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
  const stopwords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们",
    "也", "吗", "吧", "呢", "啊", "哦", "哈", "嗯", "嘛", "哟",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
  ]);
  return words.filter(w => !stopwords.has(w) && w.length < 30);
}

// Simulate highlightKeywords logic（同原文件）
function highlightKeywords(text: string, keywords: string[]): string {
  let result = text;
  for (const kw of keywords) {
    if (!kw || kw.length < 2) continue;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const regex = new RegExp(`(${escaped})`, "gi");
      result = result.replace(regex, " **$1** ");
    } catch { /* skip */ }
  }
  return result.replace(/\s{2,}/g, " ");
}

describe("语义搜索增强 (DB 层)", { concurrency: 1 }, () => {
  let db: any;

  before(() => {
    db = createDbAndSeed();
  });

  after(() => {
    try { db.close(); } catch { /* */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it("FTS5 搜索返回匹配结果", () => {
    const stmt = db.prepare(
      "SELECT date, user_text FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank"
    );
    const results = stmt.all("search") as Array<Record<string, unknown>>;
    assert.ok(results.length > 0, `FTS5 should find 'search' results, got ${results.length}`);
  });

  it("CJK 文本通过 LIKE 搜索", () => {
    const stmt = db.prepare(
      "SELECT date, user_text FROM memory_meta WHERE user_text LIKE '%项目A%'"
    );
    const results = stmt.all() as Array<Record<string, unknown>>;
    assert.strictEqual(results.length, 1);
    assert.ok(String(results[0].user_text).includes("项目A"));
  });

  it("extractKeywords 过滤中文停用词", () => {
    // CJK 文本需要空格或标点来分割；用混合中英文测试
    const kws = extractKeywords("今天 天气 不错 适合 散步 search test");
    assert.ok(kws.includes("天气"), `Expected '天气', got: ${kws.join(", ")}`);
    assert.ok(kws.includes("散步"), `Expected '散步', got: ${kws.join(", ")}`);
    assert.ok(kws.includes("search"), `Expected 'search', got: ${kws.join(", ")}`);
    assert.ok(kws.every(w => w.length >= 2), "All keywords should be >= 2 chars");
  });

  it("extractKeywords 过滤英文停用词", () => {
    const kws = extractKeywords("The quick brown fox jumps over the lazy dog");
    assert.ok(!kws.includes("the"), "Stopword 'the' should be filtered");
    assert.ok(kws.includes("quick"), "Should extract 'quick'");
    assert.ok(kws.includes("brown"), "Should extract 'brown'");
  });

  it("highlightKeywords 高亮匹配词", () => {
    const result = highlightKeywords("今天天气不错", ["天气"]);
    assert.ok(result.includes("**天气**"), `Should wrap '天气' with **, got: ${result}`);
  });

  it("highlightKeywords 不区分大小写", () => {
    const result = highlightKeywords("Hello World", ["world"]);
    assert.ok(result.includes("**World**"), `Should match case-insensitively, got: ${result}`);
  });

  it("highlightKeywords 只高亮 2+ 字符关键词", () => {
    const result = highlightKeywords("a b c test", ["a", "test"]);
    assert.ok(!result.includes("**a**"), "Single-char keyword should not highlight");
    assert.ok(result.includes("**test**"));
  });
});
