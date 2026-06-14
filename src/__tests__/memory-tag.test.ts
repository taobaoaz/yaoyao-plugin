/**
 * memory_tag 功能测试（DB 层）
 *
 * 覆盖：标签添加、搜索、移除、热门标签、孤立标签清理
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-test-"));

function createDb() {
  const db = new DatabaseSync(path.join(tmpDir, ".yaoyao.db"), { allowExtension: true });
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
  // 标签表 (模拟 memory_tag 工具)
  db.exec(
    "CREATE TABLE IF NOT EXISTS yaoyao_tags (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "memory_id INTEGER NOT NULL, " +
      "tag TEXT NOT NULL COLLATE NOCASE, " +
      "created_at TEXT DEFAULT (datetime('now'))" +
    ")"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON yaoyao_tags(tag)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_memory ON yaoyao_tags(memory_id)");
  return db;
}

function seed(db: unknown) {
  const insert = db.prepare("INSERT INTO yaoyao_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
  const entries = [
    { date: "2026-05-01", user: "项目A的架构设计", asst: "完成" },
    { date: "2026-05-02", user: "项目B的需求分析", asst: "进行中" },
    { date: "2026-05-03", user: "测试环境搭建", asst: "部署完成" },
    { date: "2026-05-04", user: "代码审查", asst: "通过" },
    { date: "2026-05-05", user: "周报汇总", asst: "已发送" },
  ];
  const ids: number[] = [];
  for (const e of entries) {
    const r = insert.run(e.date, e.user, e.asst);
    ids.push(Number(r.lastInsertRowid));
  }
  return ids;
}

describe("记忆标签系统 (DB 层)", { concurrency: 1 }, () => {
  let db: unknown;
  let ids: number[];

  before(() => {
    db = createDb();
    ids = seed(db);
  });

  after(() => {
    try { db.close(); } catch { /* */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it("添加标签到记忆条目", () => {
    const insertTag = db.prepare("INSERT OR IGNORE INTO yaoyao_tags (memory_id, tag) VALUES (?, ?)");
    insertTag.run(ids[0], "项目");
    insertTag.run(ids[0], "工作");
    insertTag.run(ids[1], "项目");
    insertTag.run(ids[1], "工作");

    const count = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags").get() as unknown;
    assert.strictEqual(count.c, 4);
  });

  it("按标签搜索", () => {
    const stmt = db.prepare(
      "SELECT t.memory_id, m.user_text, m.date " +
      "FROM yaoyao_tags t JOIN yaoyao_meta m ON t.memory_id = m.id " +
      "WHERE t.tag = ?"
    );
    const results = stmt.all("项目") as Array<Record<string, unknown>>;
    assert.ok(results.length > 0, "Should find entries tagged '项目'");
    assert.strictEqual(results[0].memory_id, ids[0]);
  });

  it("移除标签", () => {
    const del = db.prepare("DELETE FROM yaoyao_tags WHERE tag = ?");
    del.run("工作");
    const count = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags WHERE tag = '工作'").get() as unknown;
    assert.strictEqual(count.c, 0);
  });

  it("热门标签统计", () => {
    const stmt = db.prepare("SELECT tag, COUNT(*) as count FROM yaoyao_tags GROUP BY tag ORDER BY count DESC");
    const tags = stmt.all() as Array<{ tag: string; count: number }>;
    assert.ok(tags.length > 0);
    const top = tags[0];
    assert.strictEqual(top.tag, "项目");
    assert.strictEqual(top.count, 2);
  });

  it("清理孤立标签", () => {
    // 创建一个孤立标签
    db.prepare("INSERT INTO yaoyao_tags (memory_id, tag) VALUES (999, '幽灵')").run();
    const before = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags").get() as unknown;

    db.prepare("DELETE FROM yaoyao_tags WHERE memory_id NOT IN (SELECT id FROM yaoyao_meta)").run();
    const after = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags").get() as unknown;

    assert.ok(after.c < before.c, "Orphan tag should be removed");
    const ghost = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags WHERE tag = '幽灵'").get() as unknown;
    assert.strictEqual(ghost.c, 0);
  });

  it("不区分大小写", () => {
    db.prepare("INSERT INTO yaoyao_tags (memory_id, tag) VALUES (?, ?)").run(ids[2], "TestTag");
    const search = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags WHERE tag = ?").get("testtag") as unknown;
    assert.ok(search.c > 0, "Tag search should be case-insensitive");
  });

  it("移除所有标签", () => {
    db.exec("DELETE FROM yaoyao_tags");
    const count = db.prepare("SELECT COUNT(*) as c FROM yaoyao_tags").get() as unknown;
    assert.strictEqual(count.c, 0);
  });
});
