/**
 * Tests for storage/migration-v190.ts (one-shot DB unification migration).
 *
 * Strategy: create a legacy '.yaoyao.db' with memory_* tables + some rows,
 * pass an explicit targetPath so we don't touch the real home dir, then
 * call runMigrationV190 and verify the rows landed in the new DB under
 * yaoyao_* tables.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

import { runMigrationV190 } from "../storage/migration-v190.ts";
import { TABLES } from "../storage/schema.ts";

function seedLegacy(memoryDir: string): void {
  const dbPath = path.join(memoryDir, ".yaoyao.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE memory_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, user_text TEXT, asst_text TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(date, user_text, asst_text, tokenize='unicode61')`);
  db.exec(`CREATE TABLE memory_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER, tag TEXT)`);
  db.exec(`CREATE TABLE memory_config (key TEXT PRIMARY KEY, value TEXT)`);
  const today = new Date().toISOString().slice(0, 10);
  const ins = db.prepare(`INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)`);
  ins.run(today, "I like TypeScript", "Got it.");
  ins.run(today, "I work on OpenClaw plugins", "Noted.");
  ins.run(today, "Use LF line endings", "Will do.");
  const insTag = db.prepare(`INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)`);
  insTag.run(1, "preference");
  insTag.run(1, "language");
  insTag.run(2, "project");
  db.close();
}

describe("runMigrationV190", () => {
  const silentLogger = { info: () => {}, error: () => {}, warn: () => {} } as any;
  let workDir: string;
  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-mig-"));
  });
  after(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("moves rows from legacy .yaoyao.db to unified main.sqlite", () => {
    const memDir = path.join(workDir, "case1", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    seedLegacy(memDir);
    const targetPath = path.join(memDir, "main.sqlite");

    const result = runMigrationV190({ memoryDir: memDir, logger: silentLogger, targetPath });

    assert.ok(result.ran, "migration should report ran=true (reason: " + result.reason + ")");
    assert.strictEqual(result.rowsMoved, 6); // 3 memory_meta + 3 memory_tags
    assert.ok(fs.existsSync(targetPath), "target DB should exist");

    const db = new DatabaseSync(targetPath);
    const rowCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${TABLES.meta}`).get() as { c: number }).c;
    assert.strictEqual(rowCount, 3);
    const tagCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${TABLES.tags}`).get() as { c: number }).c;
    assert.strictEqual(tagCount, 3);
    db.close();
  });

  it("is idempotent - second run is a no-op", () => {
    const memDir = path.join(workDir, "case2", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    seedLegacy(memDir);
    const targetPath = path.join(memDir, "main.sqlite");

    const first = runMigrationV190({ memoryDir: memDir, logger: silentLogger, targetPath });
    const second = runMigrationV190({ memoryDir: memDir, logger: silentLogger, targetPath });

    assert.ok(first.ran, "first run should run (reason: " + first.reason + ")");
    assert.ok(!second.ran, "second run should be a no-op, reason: " + second.reason);
  });

  it("is a no-op when no legacy DB exists", () => {
    const emptyDir = path.join(workDir, "case3", "memory");
    fs.mkdirSync(emptyDir, { recursive: true });
    const targetPath = path.join(emptyDir, "main.sqlite");
    const result = runMigrationV190({ memoryDir: emptyDir, logger: silentLogger, targetPath });
    assert.ok(!result.ran);
    assert.strictEqual(result.rowsMoved, 0);
  });
});
