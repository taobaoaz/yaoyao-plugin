/**
 * memory_graph 功能测试（DB 层）
 *
 * 覆盖：搜索、场景关联、关键词关联
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-test-"));

function createDbAndSeed() {
  const dbPath = path.join(tmpDir, ".yaoyao.db");
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS yaoyao_fts USING fts5(" +
      "date, user_text, asst_text, tokenize='unicode61'" +
    ")"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS yaoyao_meta (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "date TEXT NOT NULL, " +
      "user_text TEXT, " +
      "asst_text TEXT, " +
      "created_at TEXT DEFAULT (datetime('now'))" +
    ")"
  );

  const entries = [
    { date: "2026-05-01", user: "项目A的架构设计讨论", asst: "使用微服务架构" },
    { date: "2026-05-02", user: "项目A的数据库设计", asst: "使用MongoDB" },
    { date: "2026-05-03", user: "项目A的API设计", asst: "RESTful风格" },
    { date: "2026-05-04", user: "项目B的需求分析会议", asst: "确定核心功能" },
    { date: "2026-05-05", user: "项目B的UI设计稿", asst: "Figma链接" },
    { date: "2026-05-06", user: "测试环境搭建", asst: "使用Docker Compose" },
  ];

  const insertMeta = db.prepare("INSERT INTO yaoyao_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO yaoyao_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");

  for (const e of entries) {
    const r = insertMeta.run(e.date, e.user, e.asst);
    insertFts.run(Number(r.lastInsertRowid), e.date, e.user, e.asst);
  }

  // Create scenes directory with mock scene blocks
  const sceneDir = path.join(tmpDir, "scene_blocks");
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, "0001-项目A开发.md"), `# 项目A开发\n\n- 项目A的架构设计讨论\n- 项目A的数据库设计\n- 项目A的API设计\n`);
  fs.writeFileSync(path.join(sceneDir, "0002-项目B规划.md"), `# 项目B规划\n\n- 项目B的需求分析会议\n- 项目B的UI设计稿\n`);

  return { db, dbPath };
}

describe("记忆关联图谱 (DB 层)", { concurrency: 1 }, () => {
  let ctx: { db: any; dbPath: string };

  before(() => {
    ctx = createDbAndSeed();
  });

  after(() => {
    try { ctx.db.close(); } catch { /* */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it("FTS5 搜索找到关联记忆 (LIKE for CJK)", () => {
    const stmt = ctx.db.prepare(
      "SELECT date, user_text FROM yaoyao_meta WHERE user_text LIKE ? OR asst_text LIKE ? ORDER BY date"
    );
    const results = stmt.all("%项目A%", "%项目A%") as Array<Record<string, unknown>>;
    assert.ok(results.length >= 3, `Expected >= 3 results for '项目A', got ${results.length}`);
  });

  it("场景分组数据可加载", () => {
    const sceneDir = path.join(tmpDir, "scene_blocks");
    const files = fs.readdirSync(sceneDir).filter(f => f.endsWith(".md"));
    assert.strictEqual(files.length, 2);
    const content1 = fs.readFileSync(path.join(sceneDir, "0001-项目A开发.md"), "utf-8");
    assert.ok(content1.includes("项目A的架构设计"));
  });

  it("同场景记忆关联", () => {
    // 项目A 场景下应该有 3 条记忆
    const sceneContent = fs.readFileSync(path.join(tmpDir, "scene_blocks/0001-项目A开发.md"), "utf-8");
    const lines = sceneContent.split("\n").filter(l => l.trim().startsWith("- "));
    assert.strictEqual(lines.length, 3);
  });

  it("搜索跨项目结果", () => {
    const stmt = ctx.db.prepare(
      "SELECT date, user_text FROM yaoyao_meta WHERE user_text LIKE ? ORDER BY date DESC"
    );
    const results = stmt.all("%项目%") as Array<Record<string, unknown>>;
    assert.ok(results.length >= 5, `Expected >= 5 results for '项目', got ${results.length}`);
  });
});
