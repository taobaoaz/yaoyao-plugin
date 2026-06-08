/**
 * Tests for utils/db-compat.ts — DB compatibility detection + factory.
 *
 * Run: node --experimental-strip-types --test src/__tests__/db-compat.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCompatDB, getDBCapability } from '../utils/db-compat.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('getDBCapability', () => {
  it('returns object with expected shape', () => {
    const cap = getDBCapability();
    assert.ok('backend' in cap);
    assert.ok('nodeSqliteAvailable' in cap);
    assert.ok('betterSqlite3Available' in cap);
    assert.ok(['node-sqlite', 'better-sqlite3', 'unknown'].includes(cap.backend));
    assert.strictEqual(typeof cap.nodeSqliteAvailable, 'boolean');
    assert.strictEqual(typeof cap.betterSqlite3Available, 'boolean');
  });
});

describe('createCompatDB', () => {
  it('creates a working DB via file-db fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcompat-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const result = createCompatDB(dbPath, { allowExtension: false });
    assert.ok(result.db !== undefined);
    assert.ok(['node-sqlite', 'better-sqlite3', 'file-db'].includes(result.backend));
    assert.strictEqual(typeof result.supportsFTS5, 'boolean');
    assert.strictEqual(typeof result.supportsWAL, 'boolean');
    assert.strictEqual(typeof result.supportsExtensions, 'boolean');

    // Basic operations
    result.db.exec('CREATE TABLE IF NOT EXISTS t (v TEXT)');
    const stmt = result.db.prepare('SELECT 1 AS val');
    const row = stmt.get() as Record<string, unknown>;
    assert.ok(row !== undefined);
    result.db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('handles node:sqlite backend when available', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcompat-sqlite-'));
    const dbPath = path.join(tmpDir, 'native.db');

    const result = createCompatDB(dbPath, { allowExtension: false });
    if (result.backend === 'node-sqlite') {
      // Verify it has enableLoadExtension and _raw
      assert.strictEqual(typeof result.db.enableLoadExtension, 'function');
      assert.ok(result.db._raw !== undefined);
    }
    result.db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('handles logger parameter gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbcompat-log-'));
    const logPath = path.join(tmpDir, 'log.db');
    const logged: string[] = [];
    const logger = {
      info: (m: string) => {
        logged.push(m);
      },
    };
    const result = createCompatDB(logPath, undefined, logger as never);
    assert.ok(result.db !== undefined);
    result.db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });
});
