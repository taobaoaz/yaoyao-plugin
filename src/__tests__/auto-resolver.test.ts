/**
 * Tests for utils/auto-resolver.ts — automatic conflict resolution.
 *
 * Covers: scoreCandidate, pickWinner, resolveConflictPairs, autoResolveAll.
 * Uses an in-memory DatabaseSync from node:sqlite as a UnifiedDB stub.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
import {
  scoreCandidate,
  pickWinner,
  resolveConflictPairs,
  autoResolveAll,
  DECISION_WEIGHTS,
  SOURCE_WEIGHTS,
  type ConflictCandidateRow,
} from "../utils/auto-resolver.ts";
import { TABLES } from "../storage/schema.ts";

function row(p: Partial<ConflictCandidateRow> & { id: number }): ConflictCandidateRow {
  return {
    id: p.id,
    date: p.date ?? new Date().toISOString(),
    source: p.source ?? "user",
    importance: p.importance ?? 0.5,
    accessCount: p.accessCount ?? 0,
    meta: p.meta ?? null,
  };
}

describe("DECISION_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const sum = DECISION_WEIGHTS.recency + DECISION_WEIGHTS.source + DECISION_WEIGHTS.access + DECISION_WEIGHTS.importance;
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `weights sum to ${sum}`);
  });
});

describe("SOURCE_WEIGHTS", () => {
  it("user > agent > unknown > tool", () => {
    assert.ok(SOURCE_WEIGHTS.user > SOURCE_WEIGHTS.agent);
    assert.ok(SOURCE_WEIGHTS.agent > SOURCE_WEIGHTS.unknown);
    assert.ok(SOURCE_WEIGHTS.unknown > SOURCE_WEIGHTS.tool);
  });
});

describe("scoreCandidate", () => {
  it("fresh user memory with high access scores highest", () => {
    const r = row({ id: 1, source: "user", accessCount: 10, importance: 1.0, date: new Date().toISOString() });
    const s = scoreCandidate(r);
    assert.ok(s > 0.95, `expected >0.95, got ${s}`);
  });
  it("old tool memory with no access scores low", () => {
    const oldDate = new Date(Date.now() - 365 * 86400_000).toISOString();
    const r = row({ id: 1, source: "tool", accessCount: 0, importance: 0, date: oldDate });
    const s = scoreCandidate(r);
    assert.ok(s < 0.2, `expected <0.2, got ${s}`);
  });
  it("is deterministic for same input", () => {
    const r = row({ id: 1, source: "user", accessCount: 3, importance: 0.6, date: "2025-06-01T00:00:00Z" });
    const a = scoreCandidate(r, 1700000000000);
    const b = scoreCandidate(r, 1700000000000);
    assert.strictEqual(a, b);
  });
  it("30-day-old memory has zero recency (linear decay reaches 0 at halfLife)", () => {
    // The formula is `1 - clamp01(ageDays / halfLife)`, a linear decay
    // (not a proper half-life). At exactly halfLife (30d) recency is
    // 0, so the score reduces to source weight only.
    const oldDate = new Date(Date.now() - 30 * 86400_000).toISOString();
    const r = row({ id: 1, source: "user", accessCount: 0, importance: 0, date: oldDate });
    const s = scoreCandidate(r);
    // recency=0, source=1.0*0.30 = 0.30, rest 0
    assert.ok(Math.abs(s - 0.30) < 0.05, `expected ~0.30, got ${s}`);
  });
  it("15-day-old memory has recency contribution ~0.225", () => {
    const oldDate = new Date(Date.now() - 15 * 86400_000).toISOString();
    const r = row({ id: 1, source: "user", accessCount: 0, importance: 0, date: oldDate });
    const s = scoreCandidate(r);
    // recency=0.5 * 0.45 = 0.225, source 0.30, total 0.525
    assert.ok(Math.abs(s - 0.525) < 0.05, `expected ~0.525, got ${s}`);
  });
});

describe("pickWinner", () => {
  it("user-sourced newer row beats tool-sourced older row", () => {
    const now = new Date("2025-06-15T00:00:00Z").getTime();
    const a = row({ id: 1, source: "user", accessCount: 5, importance: 0.8, date: new Date(now).toISOString() });
    const b = row({ id: 2, source: "tool", accessCount: 0, importance: 0.2, date: new Date(now - 60 * 86400_000).toISOString() });
    const r = pickWinner(a, b, now);
    assert.strictEqual(r.winner.id, 1);
    assert.strictEqual(r.loser.id, 2);
    assert.ok(r.scoreGap > 0.1);
  });
  it("ties broken by larger id (more recent write wins)", () => {
    const a = row({ id: 5, source: "user", accessCount: 0, importance: 0.5 });
    const b = row({ id: 7, source: "user", accessCount: 0, importance: 0.5 });
    const r = pickWinner(a, b);
    assert.strictEqual(r.winner.id, 7);
    assert.strictEqual(r.loser.id, 5);
    assert.strictEqual(r.reason, "tie broken by recency of write");
  });
  it('strict winner has reason "higher recency+source score"', () => {
    const now = new Date("2025-06-15T00:00:00Z").getTime();
    const a = row({ id: 1, source: "user", accessCount: 10, importance: 1.0, date: new Date(now).toISOString() });
    const b = row({ id: 2, source: "tool", accessCount: 0, importance: 0.0, date: new Date(now - 90 * 86400_000).toISOString() });
    const r = pickWinner(a, b, now);
    assert.strictEqual(r.reason, "higher recency+source score");
  });
});

describe("resolveConflictPairs with in-memory DB", () => {
  let db: InstanceType<typeof DatabaseSync>;
  before(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE ${TABLES.meta} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_text TEXT,
      asst_text TEXT,
      access_count INTEGER DEFAULT 0,
      importance REAL DEFAULT 0.5,
      meta TEXT DEFAULT '{}'
    )`);
    const now = new Date().toISOString();
    // Insert 2 rows that conflict
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "I prefer TypeScript for backend work", 3, 0.8, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "I prefer TypeScript for backend", 1, 0.6, JSON.stringify({ source: "user" }));
  });
  after(() => { try { db.close(); } catch { /* ignore */ } });

  it("marks loser with superseded_by, winner with supersedes", () => {
    const res = resolveConflictPairs(db as any, [[1, 2]]);
    assert.strictEqual(res.consideredPairs, 1);
    assert.strictEqual(res.resolvedPairs, 1);
    assert.strictEqual(res.skippedPairs, 0);
    assert.strictEqual(res.actions.length, 1);
    const winnerRow = db.prepare(`SELECT meta FROM ${TABLES.meta} WHERE id = ?`).get(res.actions[0].winnerId) as { meta: string };
    const loserRow = db.prepare(`SELECT meta FROM ${TABLES.meta} WHERE id = ?`).get(res.actions[0].loserId) as { meta: string };
    const winnerMeta = JSON.parse(winnerRow.meta);
    const loserMeta = JSON.parse(loserRow.meta);
    assert.strictEqual(loserMeta.superseded_by, res.actions[0].winnerId);
    assert.ok(Array.isArray(winnerMeta.supersedes));
    assert.ok(winnerMeta.supersedes.includes(res.actions[0].loserId));
  });

  it("dedupes pairs that share rows", () => {
    db.exec(`DELETE FROM ${TABLES.meta}`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name = '${TABLES.meta}'`);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "duplicate row A", 5, 0.9, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "duplicate row B", 3, 0.7, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "duplicate row C", 1, 0.5, JSON.stringify({ source: "user" }));
    // pairs: [1,2], [1,3], [2,3] — row 1 appears twice, row 2 appears twice
    const res = resolveConflictPairs(db as any, [[1, 2], [1, 3], [2, 3]]);
    assert.strictEqual(res.consideredPairs, 3);
    // After dedup, only [1,2] survives (1,3 has 1 taken; 2,3 has 2 taken).
    assert.strictEqual(res.resolvedPairs, 1);
  });

  it("returns empty result for empty input", () => {
    const res = resolveConflictPairs(db as any, []);
    assert.strictEqual(res.consideredPairs, 0);
    assert.strictEqual(res.resolvedPairs, 0);
    assert.deepStrictEqual(res.actions, []);
  });

  it("skips pairs where one row is missing", () => {
    const res = resolveConflictPairs(db as any, [[1, 999]]);
    assert.strictEqual(res.resolvedPairs, 0);
    assert.strictEqual(res.skippedPairs, 1);
  });

  it("skips pairs where one row is already superseded", () => {
    db.exec("DELETE FROM " + TABLES.meta);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "alpha row", 5, 0.9, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "beta row", 3, 0.7, JSON.stringify({ source: "user", superseded_by: 999 }));
    const res = resolveConflictPairs(db as any, [[1, 2]]);
    assert.strictEqual(res.resolvedPairs, 0);
    assert.strictEqual(res.skippedPairs, 1);
  });
});

describe("autoResolveAll with in-memory DB", () => {
  let db: InstanceType<typeof DatabaseSync>;
  before(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE ${TABLES.meta} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_text TEXT,
      asst_text TEXT,
      access_count INTEGER DEFAULT 0,
      importance REAL DEFAULT 0.5,
      meta TEXT DEFAULT '{}'
    )`);
  });
  after(() => { try { db.close(); } catch { /* ignore */ } });

  it("returns zero actions on empty table", () => {
    const res = autoResolveAll(db as any);
    assert.strictEqual(res.consideredPairs, 0);
    assert.strictEqual(res.resolvedPairs, 0);
  });

  it("buckets by (date, user_text[:30]) and resolves newest vs older", () => {
    const now = new Date().toISOString();
    const t = "I like dark mode for coding";
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, t, 0, 0.4, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, t, 5, 0.9, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, t, 2, 0.6, JSON.stringify({ source: "user" }));
    const res = autoResolveAll(db as any, { minScoreGap: 0.0 });
    // 3 rows -> 2 raw pairs ([newest, mid], [newest, oldest]); the
    // dedup rule pairs only one winner per run, so resolvedPairs=1.
    assert.strictEqual(res.consideredPairs, 2);
    assert.strictEqual(res.resolvedPairs, 1);
  });

  it("ignores short user_text (<5 chars)", () => {
    db.exec(`DELETE FROM ${TABLES.meta}`);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "hi", 5, 0.9, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, "hi", 5, 0.9, JSON.stringify({ source: "user" }));
    const res = autoResolveAll(db as any);
    assert.strictEqual(res.consideredPairs, 0);
  });

  it("respects minScoreGap filter", () => {
    db.exec("DELETE FROM " + TABLES.meta);
    const now = new Date().toISOString();
    const t = "near-tie text";
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, t, 1, 0.5, JSON.stringify({ source: "user" }));
    db.prepare(`INSERT INTO ${TABLES.meta} (date, user_text, access_count, importance, meta) VALUES (?, ?, ?, ?, ?)`)
      .run(now, t, 1, 0.5, JSON.stringify({ source: "user" }));
    const res = autoResolveAll(db as any, { minScoreGap: 0.5 });
    // near-tie gap is small → filter removes the resolution
    assert.strictEqual(res.resolvedPairs, 0);
  });
});
