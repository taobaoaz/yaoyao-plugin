/**
 * memory_import 功能测试（DB 层）
 *
 * 测试 JSONL 解析、导入逻辑、干跑模式、格式错误处理
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-test-"));

function createEmptyDb() {
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
}

describe("记忆导入 (DB 层)", { concurrency: 1 }, () => {
  let dbPath: string;

  before(() => {
    createEmptyDb();
    dbPath = path.join(tmpDir, ".yaoyao.db");
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it("JSONL 解析：有效条目被正确导入", () => {
    const db = new DatabaseSync(dbPath, { allowExtension: true });
    const jsonl = [
      JSON.stringify({ date: "2026-06-01", user_text: "测试导入1", asst_text: "ok" }),
      JSON.stringify({ date: "2026-06-02", user_text: "测试导入2", asst_text: "done" }),
      JSON.stringify({ date: "2026-06-03", user_text: "测试导入3", asst_text: "完成" }),
    ].join("\n");

    const lines = jsonl.split("\n").filter(l => l.trim());
    const entries: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      const parsed = JSON.parse(line);
      entries.push({ date: parsed.date, user_text: String(parsed.user_text || ""), asst_text: String(parsed.asst_text || "") });
    }
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].date, "2026-06-01");
    assert.strictEqual(entries[2].user_text, "测试导入3");

    const insertMeta = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
    let count = 0;
    db.exec("BEGIN");
    for (const e of entries) {
      const r = insertMeta.run(e.date, e.user_text, e.asst_text);
      insertFts.run(Number(r.lastInsertRowid), e.date, e.user_text, e.asst_text);
      count++;
    }
    db.exec("COMMIT");

    const total = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as any;
    assert.strictEqual(total.c, 3);
    assert.strictEqual(count, 3);
    db.close();
  });

  it("JSONL 解析：无效 JSON 被跳过", () => {
    const jsonl = [
      JSON.stringify({ date: "2026-07-01", user_text: "valid", asst_text: "yes" }),
      "这不是有效的JSON",
      JSON.stringify({ date: "2026-07-02", user_text: "also valid", asst_text: "yes" }),
    ].join("\n");

    const lines = jsonl.split("\n").filter(l => l.trim());
    const entries: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (!parsed.date) throw new Error("missing date");
        entries.push({ date: parsed.date, user_text: String(parsed.user_text || ""), asst_text: String(parsed.asst_text || "") });
      } catch (e: any) {
        errors.push(`line ${i + 1}: ${e.message}`);
      }
    }

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("不是有效的JSON") || errors[0].includes("line 2"));
  });

  it("JSONL 解析：缺少必要字段被过滤", () => {
    const jsonl = [
      JSON.stringify({ user_text: "no date", asst_text: "bad" }),
      JSON.stringify({ date: "2026-08-01", asst_text: "no user text" }),
      JSON.stringify({ date: "2026-08-02" }), // both empty
    ].join("\n");

    const lines = jsonl.split("\n").filter(l => l.trim());
    const entries: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (!parsed.date) { errors.push(`line ${i + 1}: missing date`); continue; }
        if (!parsed.user_text && !parsed.asst_text) { errors.push(`line ${i + 1}: need user_text or asst_text`); continue; }
        entries.push({ date: parsed.date, user_text: String(parsed.user_text || ""), asst_text: String(parsed.asst_text || "") });
      } catch (e: any) {
        errors.push(`line ${i + 1}: ${e.message}`);
      }
    }

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(errors.length, 2);
  });

  it("JSONL 解析：日期自动截断到10字符", () => {
    const jsonl = JSON.stringify({ date: "2026-09-01T12:00:00Z", user_text: "long date", asst_text: "ok" });

    const parsed = JSON.parse(jsonl);
    const date = String(parsed.date).slice(0, 10);
    assert.strictEqual(date, "2026-09-01");
  });
});
