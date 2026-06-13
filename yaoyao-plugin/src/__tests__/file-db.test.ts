/**
 * Tests for utils/file-db.ts — pure filesystem fallback database.
 *
 * Run: node --experimental-strip-types --test src/__tests__/file-db.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileDB } from "../utils/file-db.ts";

function freshDB(): { db: FileDB; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filedb-test-"));
  return { db: new FileDB(dir), dir };
}

function cleanUp(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

describe("FileDB", () => {
  it("exec is a no-op", () => {
    const { db, dir } = freshDB();
    db.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER)");
    db.exec("SELECT * FROM test");
    db.close();
    cleanUp(dir);
  });

  it("stores and retrieves via insert into memory_meta", () => {
    const { db, dir } = freshDB();
    const stmt = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
    const result = stmt.run("2026-05-18", "Hello", "World");
    assert.ok(result.lastInsertRowid !== undefined);
    assert.strictEqual(result.changes, 1);
    db.close();
    cleanUp(dir);
  });

  it("counts records via count(*)", () => {
    const { db, dir } = freshDB();
    const insert = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
    insert.run("2026-05-18", "A", "B");
    insert.run("2026-05-19", "C", "D");
    const row = db.prepare("SELECT count(*) FROM memory_meta").get() as Record<string, unknown>;
    assert.strictEqual(Number(row.c), 2);
    db.close();
    cleanUp(dir);
  });

  it("searches via FTS match syntax (basic substring)", () => {
    const { db, dir } = freshDB();
    db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)")
      .run("2026-05-17", "Hello World", "Test search content");
    const stmt = db.prepare("SELECT * FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?");
    const results = stmt.all("search", 10) as Array<Record<string, unknown>>;
    assert.ok(results.length > 0, "Should find result via substring search");
    db.close();
    cleanUp(dir);
  });

  it("deletes via delete from memory_meta", () => {
    const { db, dir } = freshDB();
    db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)")
      .run("2026-01-01", "delete me", "bye");
    assert.strictEqual(
      Number((db.prepare("SELECT count(*) FROM memory_meta").get() as Record<string, unknown>).c), 1
    );

    const result = db.prepare("DELETE FROM memory_meta WHERE date = ?").run("2026-01-01");
    assert.strictEqual(result.changes, 1);
    assert.strictEqual(
      Number((db.prepare("SELECT count(*) FROM memory_meta").get() as Record<string, unknown>).c), 0
    );
    db.close();
    cleanUp(dir);
  });

  it("handles Pragma journal_mode", () => {
    const { db, dir } = freshDB();
    const row = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
    assert.strictEqual(row.journal_mode, "delete");
    db.close();
    cleanUp(dir);
  });

  it("enableLoadExtension does not throw", () => {
    const { db, dir } = freshDB();
    db.enableLoadExtension?.(true);
    db.close();
    cleanUp(dir);
  });

  it("close persists the index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filedb-persist-"));
    const db1 = new FileDB(dir);
    db1.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)")
      .run("2026-02-02", "persist", "test");
    db1.close();

    const db2 = new FileDB(dir);
    const row = db2.prepare("SELECT count(*) FROM memory_meta").get() as Record<string, unknown>;
    assert.strictEqual(Number(row.c), 1);
    db2.close();
    cleanUp(dir);
  });

  it("survives corrupt index JSON", () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), "filedb-corrupt-"));
    fs.writeFileSync(path.join(corruptDir, ".yaoyao-index.json"), "{invalid json", "utf-8");
    const db = new FileDB(corruptDir);
    const row = db.prepare("SELECT count(*) FROM memory_meta").get() as Record<string, unknown>;
    assert.strictEqual(Number(row.c), 0);
    db.close();
    cleanUp(corruptDir);
  });

  it("handles unknown SQL gracefully", () => {
    const { db, dir } = freshDB();
    const stmt = db.prepare("UNKNOWN SQL");
    assert.strictEqual(stmt.run().changes, 0);
    assert.deepStrictEqual(stmt.all(), []);
    assert.strictEqual(stmt.get(), undefined);
    db.close();
    cleanUp(dir);
  });
});
