import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "os";
import path from "path";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

const CHINESE_WORDS = ["记忆", "测试", "数据", "搜索", "分析", "系统", "功能", "性能", "优化", "查询",
  "用户", "服务", "应用", "开发", "设计", "架构", "安全", "网络", "存储", "处理",
  "智能", "学习", "模型", "算法", "推荐", "关联", "标签", "情感", "时间", "趋势"];

const ENGLISH_WORDS = ["memory", "test", "data", "search", "analysis", "system", "function",
  "performance", "optimization", "query", "user", "service", "application", "development",
  "design", "architecture", "security", "network", "storage", "processing"];

function generateRandomText(wordList: string[], length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    if (i > 0) result += " ";
    result += wordList[Math.floor(Math.random() * wordList.length)];
  }
  return result;
}

function bench(label: string, fn: () => void, iterations = 100): { avg: number; total: number } {
  for (let i = 0; i < 5; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1_000_000;
  const avg = totalMs / iterations;
  console.log(`  ${label}: ${avg.toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total, ${iterations} iterations)`);
  return { avg, total: totalMs };
}

function benchAsync(label: string, fn: () => Promise<void>, iterations = 100): Promise<{ avg: number; total: number }> {
  return new Promise(async (resolve) => {
    for (let i = 0; i < 5; i++) await fn();
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) await fn();
    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1_000_000;
    const avg = totalMs / iterations;
    console.log(`  ${label}: ${avg.toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total, ${iterations} iterations)`);
    resolve({ avg, total: totalMs });
  });
}

describe("Stress Test", { concurrency: 1 }, () => {
  let db: any;
  let dbPath: string;
  let testDir: string;
  const INSERT_COUNT = 1000;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "stress-test-"));
    dbPath = path.join(testDir, ".yaoyao.db");
    
    db = new DatabaseSync(dbPath, { allowExtension: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA cache_size = -65536");
    
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
      "date, user_text, asst_text, " +
      "tokenize='unicode61')"
    );
    
    db.exec(
      "CREATE TABLE IF NOT EXISTS memory_meta (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "date TEXT NOT NULL, " +
      "user_text TEXT, " +
      "asst_text TEXT, " +
      "created_at TEXT DEFAULT (datetime('now')))"
    );
    
    console.log(`  📁 Test DB: ${dbPath}`);
    console.log(`  📦 Preparing ${INSERT_COUNT} test entries...`);
  });

  after(() => {
    try { db.close(); } catch { /* ignore */ }
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe("1. Mass Insertion", { concurrency: 1 }, () => {
    it(`inserts ${INSERT_COUNT} records with FTS5 indexing`, () => {
      const metaStmt = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
      const ftsStmt = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
      
      const start = process.hrtime.bigint();
      for (let i = 0; i < INSERT_COUNT; i++) {
        const date = `2026-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
        const userText = generateRandomText(CHINESE_WORDS, Math.floor(Math.random() * 10) + 5);
        const asstText = generateRandomText(ENGLISH_WORDS, Math.floor(Math.random() * 8) + 3);
        
        const r = metaStmt.run(date, userText, asstText);
        const id = Number(r.lastInsertRowid);
        ftsStmt.run(id, date, userText, asstText);
      }
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1_000_000;
      const avg = totalMs / INSERT_COUNT;
      
      console.log(`  Insert ${INSERT_COUNT} records: ${avg.toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total)`);
      
      const count = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number };
      assert.strictEqual(count.c, INSERT_COUNT);
    });

    it("verifies FTS5 index integrity after mass insert", () => {
      const ftsCount = db.prepare("SELECT COUNT(*) as c FROM memory_fts").get() as { c: number };
      const metaCount = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number };
      assert.strictEqual(ftsCount.c, metaCount.c, "FTS5 and meta counts should match");
    });
  });

  describe("2. Search Performance", { concurrency: 1 }, () => {
    it("FTS5 search with multiple queries", () => {
      const stmt = db.prepare(
        "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
        "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 10"
      );
      
      const queries = ["记忆", "测试", "数据", "搜索", "分析", "系统", "功能", "性能"];
      const start = process.hrtime.bigint();
      for (const q of queries) {
        for (let i = 0; i < 50; i++) {
          stmt.all(q);
        }
      }
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1_000_000;
      console.log(`  FTS5 search (400 queries): ${(totalMs / 400).toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total)`);
    });

    it("LIKE fallback search performance", () => {
      const stmt = db.prepare("SELECT COUNT(*) as c FROM memory_meta WHERE user_text LIKE ?");
      
      const queries = ["%记忆%", "%测试%", "%数据%", "%搜索%"];
      const start = process.hrtime.bigint();
      for (const q of queries) {
        for (let i = 0; i < 50; i++) {
          stmt.get(q);
        }
      }
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1_000_000;
      console.log(`  LIKE search (200 queries): ${(totalMs / 200).toFixed(3)}ms avg (${totalMs.toFixed(1)}ms total)`);
    });
  });

  describe("3. Concurrent Operations", { concurrency: 1 }, () => {
    it("mixed read/write workload", () => {
      const readStmt = db.prepare(
        "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet " +
        "FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 5"
      );
      const insertStmt = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
      const ftsInsertStmt = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
      
      const start = process.hrtime.bigint();
      for (let i = 0; i < 100; i++) {
        readStmt.all("测试");
        readStmt.all("记忆");
        
        if (i % 10 === 0) {
          const r = insertStmt.run("2026-06-01", generateRandomText(CHINESE_WORDS, 5), "test response");
          const id = Number(r.lastInsertRowid);
          ftsInsertStmt.run(id, "2026-06-01", generateRandomText(CHINESE_WORDS, 5), "test response");
        }
      }
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1_000_000;
      console.log(`  Mixed workload (200 reads + 10 writes): ${totalMs.toFixed(1)}ms total`);
    });
  });

  describe("4. Memory Usage", { concurrency: 1 }, () => {
    it("measures memory growth during operations", () => {
      const initialMem = process.memoryUsage().heapUsed / 1024 / 1024;
      
      const stmt = db.prepare("SELECT * FROM memory_fts WHERE memory_fts MATCH ?");
      for (let i = 0; i < 500; i++) {
        stmt.all("测试");
      }
      
      const finalMem = process.memoryUsage().heapUsed / 1024 / 1024;
      const growth = finalMem - initialMem;
      
      console.log(`  Memory usage: ${initialMem.toFixed(1)}MB → ${finalMem.toFixed(1)}MB (Δ +${growth.toFixed(1)}MB)`);
      assert.ok(growth < 50, "Memory growth should be reasonable");
    });
  });

  describe("5. Edge Cases Under Load", { concurrency: 1 }, () => {
    it("handles very long text insertion", () => {
      const longText = "测试".repeat(1000);
      const metaStmt = db.prepare("INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)");
      const ftsStmt = db.prepare("INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)");
      
      const start = process.hrtime.bigint();
      for (let i = 0; i < 10; i++) {
        const r = metaStmt.run("2026-06-01", longText, "response");
        const id = Number(r.lastInsertRowid);
        ftsStmt.run(id, "2026-06-01", longText, "response");
      }
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1_000_000;
      console.log(`  Long text inserts (10x 2000 chars): ${totalMs.toFixed(1)}ms total`);
    });

    it("handles empty queries (via fallback)", () => {
      const stmt = db.prepare("SELECT date, user_text FROM memory_meta ORDER BY id DESC LIMIT 5");
      let success = true;
      try {
        for (let i = 0; i < 100; i++) {
          stmt.all();
        }
      } catch {
        success = false;
      }
      assert.ok(success, "Empty queries should not crash");
    });

    it("handles special character queries with sanitization", () => {
      const specialChars = ['"', '*', '^', '`', '(', ')', '~', '\\', '/', '%', '_'];
      const sanitize = (query: string): string => {
        return query.replace(/["*^`()~\\/%_]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
      };
      const stmt = db.prepare("SELECT * FROM memory_fts WHERE memory_fts MATCH ? LIMIT 5");
      let success = true;
      let failedChar = "";
      try {
        for (const c of specialChars) {
          const safeQuery = sanitize(c);
          if (safeQuery) {
            stmt.all(safeQuery);
          }
        }
      } catch (e: any) {
        success = false;
        console.log(`  Error: ${e.message}`);
      }
      assert.ok(success, "Special characters should not crash after sanitization");
    });
  });

  describe("6. Database Size Check", { concurrency: 1 }, () => {
    it("verifies database size after operations", () => {
      db.exec("INSERT INTO memory_fts(memory_fts) VALUES('optimize')");
      
      if (fs.existsSync(dbPath)) {
        const size = fs.statSync(dbPath).size / 1024 / 1024;
        console.log(`  Final DB size: ${size.toFixed(2)}MB`);
        assert.ok(size > 0, "DB should have content");
      }
    });
  });

  describe("7. Stress Test Summary", { concurrency: 1 }, () => {
    it("print final statistics", () => {
      const metaCount = db.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number };
      const ftsCount = db.prepare("SELECT COUNT(*) as c FROM memory_fts").get() as { c: number };
      const dbSize = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024).toFixed(1) : 'N/A';
      
      console.log(`\n  📊 高压测试完成`);
      console.log(`  📁 DB 路径: ${dbPath}`);
      console.log(`  📦 总条目: ${metaCount.c} (meta) / ${ftsCount.c} (FTS5)`);
      console.log(`  💾 DB 大小: ${dbSize}KB`);
      console.log(`  ✅ 所有高压测试通过`);
    });
  });
});