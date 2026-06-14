/**
 * Tests for storage/schema.ts — Schema management.
 *
 * Run: node --experimental-strip-types --test src/__tests__/schema.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");

import { ensureSchema } from "../storage/schema.ts";

function createMemDB() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

describe("ensureSchema", () => {
  let db: ReturnType<typeof createMemDB>;

  before(() => { db = createMemDB(); });

  it("creates tables without error", () => {
    assert.doesNotThrow(() => ensureSchema(db));
  });

  it("is idempotent", () => {
    assert.doesNotThrow(() => ensureSchema(db));
  });

  it("creates yaoyao_meta table", () => {
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='yaoyao_meta'").get() as any;
    assert.ok(r && r.name === "yaoyao_meta");
  });

  it("creates yaoyao_fts virtual table", () => {
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='yaoyao_fts'").get() as any;
    assert.ok(r);
  });

  it("creates yaoyao_tags and yaoyao_config tables", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='yaoyao_tags'").get() as any;
    const c = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='yaoyao_config'").get() as any;
    assert.ok(t);
    assert.ok(c);
  });
});
