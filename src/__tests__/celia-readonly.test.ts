/**
 * Tests for celia read-only bridge (v1.9.1).
 *
 * Covers:
 *   - CeliaDbReader opening a temp celia-shaped db read-only and querying
 *   - createCeliaReadOnlyTool dispatching across the 4 sources
 *
 * Run: node --test src/__tests__/celia-readonly.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { CeliaDbReader } from "../celia/db-reader.ts";
import { createCeliaReadOnlyTool } from "../celia/proxy-tools.ts";
import type { ToolRegistration } from "../tools/common.ts";

const _require = createRequire(import.meta.url);

/** Build a temp celia-shaped sqlite db with sample rows, return its path. */
function buildCeliaDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "celia-ro-"));
  const dbPath = join(dir, "celia_memory.db");
  // Prefer better-sqlite3; fall back to node:sqlite. Both expose exec/prepare.
  let db;
  try {
    const Database = _require("better-sqlite3");
    db = new Database(dbPath);
  } catch {
    const { DatabaseSync } = _require("node:sqlite");
    db = new DatabaseSync(dbPath);
  }
  db.exec(`CREATE TABLE mem_atomic (id INTEGER PRIMARY KEY, tenant_id TEXT, user_id TEXT, content TEXT, category TEXT, confidence REAL, source TEXT, created_at_ms INTEGER, updated_at_ms INTEGER)`);
  db.exec(`CREATE TABLE mem_conversation (id INTEGER PRIMARY KEY, tenant_id TEXT, user_id TEXT, conversation_id TEXT, content TEXT, scope TEXT, created_at_ms INTEGER)`);
  db.exec(`CREATE TABLE mem_global (id INTEGER PRIMARY KEY, tenant_id TEXT, user_id TEXT, type TEXT, content TEXT, created_at_ms INTEGER, updated_at_ms INTEGER)`);
  db.exec(`CREATE TABLE mem_l1_index (id INTEGER PRIMARY KEY, tenant_id TEXT, user_id TEXT, path TEXT, summary TEXT, created_at_ms INTEGER, updated_at_ms INTEGER)`);
  db.prepare(`INSERT INTO mem_atomic (tenant_id,user_id,content,category,confidence,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)`).run("default", "u1", "用户偏好喝咖啡", "preference", 0.9, 1, 1);
  db.prepare(`INSERT INTO mem_atomic (tenant_id,user_id,content,category,confidence,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)`).run("default", "u1", "用户不喜欢茶", "preference", 0.8, 2, 2);
  db.prepare(`INSERT INTO mem_conversation (tenant_id,user_id,conversation_id,content,scope,created_at_ms) VALUES (?,?,?,?,?,?)`).run("default", "u1", "c1", '[{"role":"user","text":"部署方案"}]', "user", 10);
  db.prepare(`INSERT INTO mem_global (tenant_id,user_id,type,content,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)`).run("default", "u1", "edge", "用户画像：工程师", 1, 1);
  db.prepare(`INSERT INTO mem_l1_index (tenant_id,user_id,path,summary,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)`).run("default", "u1", "L1_scene_work", "工作场景", 1, 1);
  db.close();
  return dbPath;
}

describe("CeliaDbReader (read-only)", () => {
  let dbPath: string;
  before(() => { dbPath = buildCeliaDb(); });
  after(() => { try { rmSync(join(dbPath, ".."), { recursive: true, force: true }); } catch { /* win */ } });

  it("reads atomic facts by LIKE when no FTS table", () => {
    const r = new CeliaDbReader(dbPath);
    const rows = r.readAtomicFacts("咖啡");
    assert.ok(rows.length >= 1);
    assert.ok(rows[0].content.includes("咖啡"));
    r.close();
  });

  it("reads conversations", () => {
    const r = new CeliaDbReader(dbPath);
    const rows = r.readConversations("部署");
    assert.ok(rows.length >= 1);
    r.close();
  });

  it("reads global summary by tier", () => {
    const r = new CeliaDbReader(dbPath);
    const rows = r.readGlobalSummary("edge");
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].content.includes("工程师"));
    r.close();
  });

  it("reads scene index", () => {
    const r = new CeliaDbReader(dbPath);
    const rows = r.readSceneIndex();
    assert.ok(rows.length >= 1);
    assert.ok(rows.some((x) => x.path === "L1_scene_work"));
    r.close();
  });

  it("returns [] gracefully for a missing db path", () => {
    const r = new CeliaDbReader(join(tmpdir(), "does-not-exist.db"));
    assert.deepStrictEqual(r.readAtomicFacts("x"), []);
    assert.deepStrictEqual(r.readConversations("x"), []);
    r.close();
  });
});

describe("createCeliaReadOnlyTool", () => {
  let dbPath: string;
  let reader: CeliaDbReader;
  let tool: ToolRegistration;
  before(() => {
    dbPath = buildCeliaDb();
    reader = new CeliaDbReader(dbPath);
    tool = createCeliaReadOnlyTool(reader, {});
  });
  after(() => {
    reader.close();
    try { rmSync(join(dbPath, ".."), { recursive: true, force: true }); } catch { /* win */ }
  });

  async function call(params: Record<string, unknown>): Promise<string> {
    const t = tool as unknown as { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> };
    const res = await t.execute("t1", params);
    return res.content[0].text;
  }

  it("dispatches source=atomic and returns matching fact", async () => {
    const text = await call({ source: "atomic", query: "咖啡" });
    assert.ok(text.includes("咖啡"));
  });

  it("dispatches source=global with tier", async () => {
    const text = await call({ source: "global", tier: "edge" });
    assert.ok(text.includes("工程师"));
  });

  it("dispatches source=scene", async () => {
    const text = await call({ source: "scene" });
    assert.ok(text.includes("L1_scene_work"));
  });

  it("reports empty gracefully when no match", async () => {
    const text = await call({ source: "atomic", query: "zzz_nomatch_zzz" });
    assert.ok(text.includes("无匹配") || text.includes("为空"));
  });
});
