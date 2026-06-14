/**
 * Regression test for core/boot/md-sync.ts — silent DB-read failure.
 *
 * Before the fix: if the count(*) query on yaoyao_meta threw (e.g.
 * SQLite locked, table corrupt, extension missing), the catch block
 * silently set dbRecordCount = 0, which made the code fall through
 * to isBulkImport = true. That re-imports every .md file in memoryDir,
 * which is a silent data hazard: duplicate rows if the DB was already
 * partially populated but the count failed.
 *
 * After the fix: when the DB read fails, we log a warning and abort
 * the sync with stats.errors = 1, leaving the .md files untouched as
 * the source of truth.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncMarkdownToFTS } from "../core/boot/md-sync.ts";
import type { Storage } from "../storage/bridge.ts";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-mdsync-"));
}

interface LoggerEvent { level: "info" | "debug" | "warn" | "error"; msg: string; }

function makeCapturingLogger() {
  const events: LoggerEvent[] = [];
  return {
    events,
    info: (msg: string) => events.push({ level: "info", msg }),
    debug: (msg: string) => events.push({ level: "debug", msg }),
    warn: (msg: string) => events.push({ level: "warn", msg }),
    error: (msg: string) => events.push({ level: "error", msg }),
  };
}

test("md-sync aborts and warns when DB count query throws", () => {
  const memDir = mkTempDir();
  try {
    // Pre-populate a .md file that the bulk-import path would otherwise
    // silently re-import.
    const md = [
      "### 2026-06-13 12:00:00",
      "**User:** hello world",
      "**AI:** hi there",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(memDir, "2026-06-13.md"), md, "utf-8");

    let indexTurnCalls = 0;
    const mockDb = {
      getRawDb: () => {
        // Simulate locked/corrupt DB: prepare().get() throws.
        return {
          prepare: () => ({
            get: () => { throw new Error("database is locked"); },
          }),
        };
      },
      indexTurn: () => {
        indexTurnCalls++;
        return -1;
      },
    } as unknown as Storage;

    const logger = makeCapturingLogger();
    const stats = syncMarkdownToFTS(memDir, mockDb, logger);

    // Bulk-import must NOT have happened — indexTurn should never be called.
    assert.equal(indexTurnCalls, 0, "indexTurn must not be called when DB read fails");
    // And the abort must be logged as a warning.
    const warnings = logger.events.filter(e => e.level === "warn");
    assert.ok(
      warnings.some(w => w.msg.includes("DB read failed") || w.msg.includes("Could not read DB")),
      `Expected a warning about DB read failure. Warnings: ${JSON.stringify(warnings)}`
    );
    // Stats should reflect the abort (errors > 0, imported = 0).
    assert.equal(stats.imported, 0, "no rows should be imported");
    assert.ok(stats.errors > 0, `expected errors > 0, got ${stats.errors}`);
  } finally {
    fs.rmSync(memDir, { recursive: true, force: true });
  }
});

test("md-sync performs selective import when DB is readable and non-empty", () => {
  const memDir = mkTempDir();
  try {
    const md = [
      "### 2026-06-13 12:00:00",
      "**User:** hello world",
      "**AI:** hi there",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(memDir, "2026-06-13.md"), md, "utf-8");

    let indexTurnCalls = 0;
    const mockDb = {
      getRawDb: () => ({
        prepare: () => ({
          get: (sql?: string) => {
            // For the COUNT query: return non-zero so we go down the
            // selective path. For the existsInDb check: return undefined
            // so the turn is treated as missing and gets inserted.
            if (typeof sql === "string" && sql.includes("COUNT(*)")) return { c: 5 };
            return undefined;
          },
        }),
      }),
      indexTurn: () => {
        indexTurnCalls++;
        return indexTurnCalls; // pretend each call inserts a row
      },
    } as unknown as Storage;

    const logger = makeCapturingLogger();
    const stats = syncMarkdownToFTS(memDir, mockDb, logger);

    // Selective path: each turn is checked against DB and only missing ones
    // are inserted. We expect at least one import from the single .md file.
    assert.ok(stats.imported >= 1, `expected at least 1 import, got ${stats.imported}`);
  } finally {
    fs.rmSync(memDir, { recursive: true, force: true });
  }
});
