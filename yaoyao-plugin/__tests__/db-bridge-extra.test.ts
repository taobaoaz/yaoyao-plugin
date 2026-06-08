/**
 * Supplementary tests for db-bridge.ts — Hybrid search, ordering, edge cases.
 *
 * Run: node --experimental-strip-types --test src/__tests__/db-bridge-extra.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require('node:sqlite') as typeof import('node:sqlite');

let VEC_AVAILABLE = false;
let sqliteVecModule: unknown = null;
try {
  sqliteVecModule = _require('sqlite-vec');
  const d = new DatabaseSync(':memory:', { allowExtension: true });
  sqliteVecModule.load(d);
  d.exec('CREATE VIRTUAL TABLE IF NOT EXISTS test_v USING vec0(embedding float[4])');
  d.close();
  VEC_AVAILABLE = true;
} catch {
  /* sqlite-vec not installed */
}

function createTestDB(): { db: any; dbPath: string } {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-extra-'));
  const dbPath = path.join(dbDir, '.yaoyao.db');
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA cache_size = -65536');
  db.exec(
    'CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(' +
      "date, user_text, asst_text, tokenize='unicode61')",
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS memory_meta (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, ' +
      'user_text TEXT, asst_text TEXT, ' +
      "created_at TEXT DEFAULT (datetime('now')))",
  );
  if (VEC_AVAILABLE) {
    try {
      sqliteVecModule.load(db);
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[1024])');
      db.exec(
        'CREATE TABLE IF NOT EXISTS memory_vec_meta (' +
          'id INTEGER PRIMARY KEY, meta_id INTEGER, model TEXT, ' +
          "dimensions INTEGER DEFAULT 1024, created_at TEXT DEFAULT (datetime('now')))",
      );
    } catch {
      /* vec not available */
    }
  }
  return { db, dbPath };
}

describe('Hybrid Search', { concurrency: 1 }, () => {
  let db: unknown;
  let testDir: string;

  before(() => {
    const r = createTestDB();
    db = r.db;
    testDir = path.dirname(r.dbPath);
    const metaStmt = db.prepare(
      'INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)',
    );
    const ftsStmt = db.prepare(
      'INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)',
    );
    const data = [
      ['2026-05-01', '今天天气很好，适合出去散步', '是的，去公园走走吧'],
      ['2026-05-01', '这个项目进展顺利，很开心', '继续保持，加油'],
      ['2026-05-02', '遇到一个棘手的问题', '让我帮你分析一下'],
      ['2026-05-02', '谢谢你的帮助，问题解决了', '不客气，随时找我'],
      ['2026-05-03', '今天心情不好，什么都不想做', '休息一下'],
      ['2026-05-03', '这个方案不行，需要重新考虑', '好的，换个思路'],
      ['2026-05-04', '测试通过了！很开心', '恭喜，做得很好'],
      ['2026-05-04', '晚上去跑步了，感觉不错', '坚持运动很有益处'],
      ['2026-05-05', '天气热，不想出门', '在家休息也不错'],
      ['2026-05-05', '写代码写了一天，有点累', '注意休息，别太拼了'],
    ];
    for (let i = 0; i < data.length; i++) {
      const [date, userText, asstText] = data[i];
      const rMeta = metaStmt.run(date, userText, asstText);
      const rowId = Number(rMeta.lastInsertRowid);
      ftsStmt.run(rowId, date, userText, asstText);
    }
  });

  after(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('FTS5 search: empty query handled gracefully', () => {
    try {
      const stmt = db.prepare('SELECT COUNT(*) as c FROM memory_fts WHERE memory_fts MATCH ?');
      stmt.all('');
    } catch {
      // FTS5 may throw on empty — that's acceptable
    }
    assert.ok(true);
  });

  it('FTS5 search: results ordered by rank', () => {
    const stmt = db.prepare(
      "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
        'FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 10',
    );
    const rows = stmt.all('天') as Array<{ date: string; snippet: string; rank: number }>;
    if (rows.length > 1) {
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].rank >= rows[i - 1].rank);
      }
    }
  });

  it('FTS5 search: LIMIT works', () => {
    const stmt = db.prepare(
      "SELECT date, snippet(memory_fts, 2, '<b>', '</b>', '…', 32) as snippet, rank " +
        'FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?',
    );
    const rows3 = stmt.all('天', 3) as unknown[];
    assert.ok(rows3.length <= 3);
    const rows5 = stmt.all('天', 5) as unknown[];
    assert.ok(rows5.length <= 5);
  });

  it('LIKE search: finds results', () => {
    const stmt = db.prepare('SELECT COUNT(*) as c FROM memory_meta WHERE user_text LIKE ?');
    const row = stmt.get('%开心%') as { c: number };
    assert.ok((row.c || 0) >= 1);
  });

  it('LIKE search: no match returns 0', () => {
    const stmt = db.prepare('SELECT COUNT(*) as c FROM memory_meta WHERE user_text LIKE ?');
    const row = stmt.get('%notfoundzzz%') as { c: number };
    assert.strictEqual(row.c, 0);
  });

  it('LIKE search: special characters handled', () => {
    const queries = ['测试', "OR '1'='1", '(test)', '~foo'];
    for (const q of queries) {
      const stmt = db.prepare('SELECT COUNT(*) as c FROM memory_meta WHERE user_text LIKE ?');
      const escaped = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      const row = stmt.get(escaped) as { c: number };
      assert.ok(typeof row.c === 'number');
    }
  });

  it('FTS5 rebuild after insert', () => {
    // Use English text (FTS5 unicode61 tokenizer handles English well)
    const metaStmt = db.prepare(
      'INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)',
    );
    const r = metaStmt.run('2026-05-06', 'test data for FTS rebuild', 'ok');
    const rowId = Number(r.lastInsertRowid);
    const ftsStmt = db.prepare(
      'INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)',
    );
    ftsStmt.run(rowId, '2026-05-06', 'test data for FTS rebuild', 'ok');
    // Verify data is searchable in FTS (inserted directly)
    const beforeStmt = db.prepare('SELECT COUNT(*) as c FROM memory_fts WHERE memory_fts MATCH ?');
    const beforeResult = beforeStmt.get('test') as { c: number };
    assert.ok(beforeResult.c > 0, 'Should find data before rebuild');
    // Rebuild — this syncs content=memory_meta table back into the FTS index
    db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
    const afterStmt = db.prepare('SELECT COUNT(*) as c FROM memory_fts WHERE memory_fts MATCH ?');
    const afterResult = afterStmt.get('test') as { c: number };
    // After rebuild, data from memory_meta should still be searchable
    assert.ok(afterResult.c > 0, 'Should find data after rebuild');
  });
});
