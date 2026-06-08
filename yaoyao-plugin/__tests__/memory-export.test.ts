/**
 * memory-export / memory-import 功能测试
 *
 * 直接测试 JSONL 格式的导出和导入逻辑（通过 DB 层）
 * 运行: node --experimental-strip-types --test src/__tests__/memory-export.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require('node:sqlite') as typeof import('node:sqlite');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
const dbPath = path.join(tmpDir, '.yaoyao.db');

function createDb() {
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    'CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(' +
      "date, user_text, asst_text, tokenize='unicode61'" +
      ')',
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS memory_meta (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'date TEXT NOT NULL, ' +
      'user_text TEXT, ' +
      'asst_text TEXT, ' +
      "created_at TEXT DEFAULT (datetime('now'))" +
      ')',
  );
  return db;
}

function seed(db: unknown) {
  const insertMeta = db.prepare(
    'INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)',
  );
  const insertFts = db.prepare(
    'INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)',
  );
  const entries = [
    { date: '2026-04-01', user: '今天天气不错', asst: '是的' },
    { date: '2026-04-15', user: '完成了项目A的架构设计', asst: '干得好' },
    { date: '2026-05-01', user: '遇到了一个bug', asst: '已修复' },
    { date: '2026-05-02', user: '搜索测试数据', asst: '找到相关结果' },
    { date: '2026-05-03', user: '研究记忆系统优化', asst: '好建议' },
    { date: '2026-05-04', user: 'Export test entry', asst: 'Test for JSONL' },
  ];
  for (const e of entries) {
    const r = insertMeta.run(e.date, e.user, e.asst);
    insertFts.run(Number(r.lastInsertRowid), e.date, e.user, e.asst);
  }
}

describe('记忆导出/导入 (DB 层)', { concurrency: 1 }, () => {
  let db: unknown;

  before(() => {
    db = createDb();
    seed(db);
  });

  after(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* */
    }
  });

  it('导出的 JSONL 格式正确', () => {
    const stmt = db.prepare('SELECT date, user_text, asst_text FROM memory_meta ORDER BY id');
    const rows = stmt.all() as Array<Record<string, unknown>>;
    const jsonl = rows
      .map((r) =>
        JSON.stringify({
          date: r.date,
          user_text: r.user_text,
          asst_text: r.asst_text,
        }),
      )
      .join('\n');

    assert.ok(jsonl.includes('2026-04-01'));
    assert.ok(jsonl.includes('今天天气不错'));

    // 验证每行都是合法 JSON
    for (const line of jsonl.split('\n')) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.date);
      assert.ok(typeof parsed.user_text === 'string');
    }
  });

  it('导出支持日期筛选', () => {
    const stmt = db.prepare(
      'SELECT date, user_text, asst_text FROM memory_meta WHERE date >= ? ORDER BY date',
    );
    const rows = stmt.all('2026-05-01') as Array<Record<string, unknown>>;
    assert.ok(rows.length >= 4, `Expected >= 4 May entries, got ${rows.length}`);
    for (const row of rows) {
      assert.ok(String(row.date) >= '2026-05-01');
    }
  });

  it('导出支持关键词后过滤', () => {
    const stmt = db.prepare('SELECT date, user_text, asst_text FROM memory_meta ORDER BY id');
    const rows = stmt.all() as Array<Record<string, unknown>>;
    const kw = '项目';
    const filtered = rows.filter(
      (r) => String(r.user_text || '').includes(kw) || String(r.asst_text || '').includes(kw),
    );
    assert.ok(filtered.length > 0, "Should find entries matching '项目'");
  });

  it('导入新数据到空表', () => {
    // 创建独立的 DB
    const importDbPath = path.join(tmpDir, '.import-test.db');
    const importDb = new DatabaseSync(importDbPath, { allowExtension: true });
    importDb.exec(
      "CREATE TABLE IF NOT EXISTS memory_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, user_text TEXT, asst_text TEXT, created_at TEXT DEFAULT (datetime('now')))",
    );

    // 模拟导入
    const entries = [
      { date: '2026-06-01', user: '导入测试1', asst: 'ok' },
      { date: '2026-06-02', user: '导入测试2', asst: 'done' },
    ];
    const insert = importDb.prepare(
      'INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)',
    );
    for (const e of entries) {
      insert.run(e.date, e.user, e.asst);
    }
    const count = importDb.prepare('SELECT COUNT(*) as c FROM memory_meta').get() as unknown;
    assert.strictEqual(count.c, 2);
    importDb.close();
  });
});
