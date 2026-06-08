/**
 * Tests for storage/schema.ts — Schema management.
 *
 * Run: node --experimental-strip-types --test src/__tests__/schema.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require('node:sqlite') as typeof import('node:sqlite');

import { ensureSchema } from '../storage/schema.ts';

function createMemDB() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

describe('ensureSchema', () => {
  let db: ReturnType<typeof createMemDB>;

  before(() => {
    db = createMemDB();
  });

  it('creates tables without error', () => {
    assert.doesNotThrow(() => ensureSchema(db));
  });

  it('is idempotent', () => {
    assert.doesNotThrow(() => ensureSchema(db));
  });

  it('creates memory_meta table', () => {
    const r = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_meta'")
      .get() as any;
    assert.ok(r && r.name === 'memory_meta');
  });

  it('creates memory_fts virtual table', () => {
    const r = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'")
      .get() as any;
    assert.ok(r);
  });

  it('creates memory_tags and memory_config tables', () => {
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_tags'")
      .get() as any;
    const c = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_config'")
      .get() as any;
    assert.ok(t);
    assert.ok(c);
  });
});
