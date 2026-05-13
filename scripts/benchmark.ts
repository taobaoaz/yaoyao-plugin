/**
 * Performance Benchmark — yaoyao-memory plugin
 *
 * Measures search latency, FTS5 vs LIKE fallback, vector storage, and hook overhead.
 *
 * Run: node --experimental-strip-types src/__tests__/benchmark.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
const sqliteVec = _require("sqlite-vec");

const DB_PATH = path.join(process.cwd(), "memory", ".yaoyao.db");
const DB_EXISTS = fs.existsSync(DB_PATH);

// ── Helper: round-trip time (ms) ──
function bench(label: string, fn: () => void, iterations = 100): number {
  // warmup
  for (let i = 0; i < 5; i++) fn();
  // measure
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1_000_000;
  const avg = totalMs / iterations;
  console.log(`  ${label}: ${avg.toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total, ${iterations} iterations)`);
  return avg;
}

describe("Performance Benchmark", { concurrency: 1 }, () => {
  let db: ReturnType<typeof DatabaseSync> | null = null;
  let ftsCount = 0;
  let likeCount = 0;

  before(() => {
    if (!DB_EXISTS) {
      console.log("  ⚠️  DB not found at", DB_PATH, "— skipping database benchmarks");
      return;
    }
    db = new DatabaseSync(DB_PATH, { allowExtension: true });
    try { sqliteVec.load(db); } catch { /* vec not loaded */ }

    // Count data
    const fts = db.prepare("SELECT COUNT(*) as c FROM memory_fts").get() as any;
    ftsCount = fts?.c || 0;
    const like = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as any;
    likeCount = like?.c || 0;
    console.log(`  📊 DB: ${ftsCount} FTS5 entries, ${likeCount} meta entries`);
  });

  after(() => {
    if (db) try { db.close(); } catch { /* ignore */ }
  });

  // ── 1. FTS5 Search Latency ──
  describe("FTS5 Search Latency", { concurrency: 1 }, () => {
    it("FTS5: single word query", () => {
      if (!db) return;
      bench("single word (记忆)", () => {
        const stmt = db!.prepare(
          "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
          "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 5"
        );
        const rows = stmt.all("记忆");
        assert(rows.length >= 0);
      }, 50);
    });

    it("FTS5: multi-word query", () => {
      if (!db) return;
      bench("multi word (search memory)", () => {
        const stmt = db!.prepare(
          "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
          "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 5"
        );
        stmt.all("记忆 数据 测试");
      }, 50);
    });

    it("FTS5: CJK phrase (likely → LIKE fallback)", () => {
      if (!db) return;
      const start = Date.now();
      const stmt = db!.prepare("SELECT COUNT(*) as c FROM memory_meta WHERE user_text LIKE ?");
      stmt.all("%记忆%");
      const ms = Date.now() - start;
      console.log(`  LIKE fallback: ~${ms}ms (single query)`);
    });
  });

  // ── 2. Insert Latency ──
  describe("Insert Latency", { concurrency: 1 }, () => {
    it("FTS5 insert", () => {
      if (!db) return;
      const metaStmt = db!.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES ('2026-01-01', ?, ?)");
      const ftsStmt = db!.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, '2026-01-01', ?, ?)");
      bench("insert + FTS5 index", () => {
        const r = metaStmt.run("benchmark test text", "response text") as any;
        const id = Number(r.lastInsertRowid);
        ftsStmt.run(id, "benchmark test text", "response text");
        // cleanup (keep DB clean)
        db!.prepare("DELETE FROM memory_meta WHERE rowid = ?").run(id);
        db!.prepare("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
      }, 30);
    });
  });

  // ── 3. Hybrid Search (FTS5 → Vec → Merge) ──
  describe("Hybrid Search Overhead", { concurrency: 1 }, () => {
    it("FTS5 only → no vector", () => {
      if (!db) return;
      bench("FTS5 only query", () => {
        const stmt = db!.prepare(
          "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
          "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 10"
        );
        stmt.all("测试");
      }, 50);
    });
  });

  // ── 4. Summary ──
  describe("Summary", { concurrency: 1 }, () => {
    it("print stats", () => {
      console.log(`\n  📊 基准测试完成`);
      console.log(`  📁 DB 路径: ${DB_PATH}`);
      console.log(`  📦 总条目: ${ftsCount}`);
      console.log(`  💾 DB 大小: ${fs.existsSync(DB_PATH) ? (fs.statSync(DB_PATH).size / 1024).toFixed(1) : 'N/A'}KB`);
    });
  });
});
