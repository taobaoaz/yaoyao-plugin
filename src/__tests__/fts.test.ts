/**
 * Tests for storage/fts.ts — FTS5 search engine.
 *
 * Run: node --experimental-strip-types --test src/__tests__/fts.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

import { createFtsEngine, type FtsEngine } from "../storage/fts.ts";

function createMemDB() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
    "date, user_text, asst_text, tokenize='unicode61')");
  db.exec("CREATE TABLE IF NOT EXISTS memory_meta (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, " +
    "user_text TEXT, asst_text TEXT, meta TEXT, " +
    "created_at TEXT DEFAULT (datetime('now')))");
  return db;
}

describe("FtsEngine", () => {
  let engine: FtsEngine;
  let db: ReturnType<typeof createMemDB>;

  before(() => {
    engine = createFtsEngine();
    db = createMemDB();
  });

  it("indexes a turn and returns positive rowId", () => {
    const rowId = engine.indexTurn(db, "Hello world", "Hi there", "2025-01-01");
    assert.ok(rowId > 0);
  });

  it("indexes and searches by FTS5 match", () => {
    engine.indexTurn(db, "我喜欢吃苹果", "苹果很好吃", "2025-01-02");
    engine.indexTurn(db, "今天天气很好", "适合出去走走", "2025-01-02");
    const results = engine.search(db, "苹果", 10);
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.snippet.includes("苹果")));
  });

  it("returns empty for unmatched query", () => {
    assert.strictEqual(engine.search(db, "zzzznoexistzzzz", 10).length, 0);
  });

  it("returns all entries on empty query", () => {
    assert.ok(engine.search(db, "", 10).length > 0);
  });

  it("respects LIMIT parameter", () => {
    for (let i = 0; i < 5; i++) engine.indexTurn(db, `e ${i}`, `r ${i}`, "2025-03-01");
    assert.strictEqual(engine.search(db, "", 3).length, 3);
  });

  it("searchAll returns latest entries", () => {
    const results = engine.searchAll(db, 5);
    assert.ok(results.length > 0 && results.length <= 5);
  });

  it("deleteByDate removes from memory_meta", () => {
    engine.indexTurn(db, "delbydate test", "gone", "2025-04-01");
    const beforeDel = engine.search(db, "delbydate", 10);
    assert.ok(beforeDel.length > 0, "Should find entry before delete");
    const deleted = engine.deleteByDate(db, "2025-04-01");
    assert.ok(deleted > 0, "Meta delete count should be > 0");
  });

  it("deleteByKeyword removes from memory_meta", () => {
    engine.indexTurn(db, "kwtest abc", "def", "2025-05-01");
    const deleted = engine.deleteByKeyword(db, "kwtest");
    assert.ok(deleted > 0, "Meta delete count should be > 0");
  });

  it("scheduleRebuild does not throw", () => {
    assert.doesNotThrow(() => engine.scheduleRebuild(db));
  });
});
