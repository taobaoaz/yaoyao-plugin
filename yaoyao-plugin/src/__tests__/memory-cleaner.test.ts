/**
 * Tests for utils/memory-cleaner.ts — Scheduled cleanup logic.
 *
 * Run: node --experimental-strip-types --test src/__tests__/memory-cleaner.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCleanTime, getNextCleanTimeMs, createMemoryCleaner } from "../utils/memory-cleaner.ts";

describe("parseCleanTime", () => {
  it("parses valid time string", () => {
    const r = parseCleanTime("03:30");
    assert.deepStrictEqual(r, { hour: 3, minute: 30 });
  });

  it("returns null for invalid format", () => {
    assert.strictEqual(parseCleanTime("abc"), null);
    assert.strictEqual(parseCleanTime("123:45"), null);
    assert.strictEqual(parseCleanTime(""), null);
    assert.strictEqual(parseCleanTime(undefined), null);
  });

  it("returns null for out-of-range values", () => {
    assert.strictEqual(parseCleanTime("24:00"), null);
    assert.strictEqual(parseCleanTime("12:60"), null);
  });
});

describe("getNextCleanTimeMs", () => {
  it("returns finite positive number for valid time", () => {
    const ms = getNextCleanTimeMs("03:00");
    assert.ok(typeof ms === "number");
    assert.ok(Number.isFinite(ms));
    assert.ok(ms > 0);
  });

  it("returns 0 for undefined", () => {
    const ms = getNextCleanTimeMs(undefined);
    assert.strictEqual(ms, 0);
  });
});

function mockDb() {
  return {
    exec: () => {},
    prepare: () => ({
      run: () => ({ changes: 1 }),
      all: () => [],
      get: () => undefined,
    }),
    close: () => {},
  } as never;
}

describe("createMemoryCleaner", () => {
  it("creates cleaner without throwing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-test-"));
    const cleaner = createMemoryCleaner(tmpDir, mockDb(), { l0l1RetentionDays: 30 });
    assert.ok(cleaner !== undefined);
    assert.strictEqual(typeof cleaner.cleanup, "function");
    assert.strictEqual(typeof cleaner.validateConfig, "function");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateConfig returns null for disabled (0 days)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-disabled-"));
    const cleaner = createMemoryCleaner(tmpDir, mockDb(), { l0l1RetentionDays: 0 });
    assert.strictEqual(cleaner.validateConfig(), null, "0 = disabled, no warning");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validateConfig warns on aggressive cleanup without flag", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-aggro-"));
    const cleaner = createMemoryCleaner(tmpDir, mockDb(), {
      l0l1RetentionDays: 1,
      allowAggressiveCleanup: false,
    });
    const warn = cleaner.validateConfig();
    assert.ok(warn !== null, "Should warn about aggressive config");
    assert.ok(warn!.includes("allowAggressiveCleanup=true"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cleanup runs without error on empty directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-cleanup-"));
    const cleaner = createMemoryCleaner(tmpDir, mockDb(), { l0l1RetentionDays: 30 });
    const result = cleaner.cleanup();
    assert.ok(typeof result.deleted === "number");
    assert.ok(typeof result.archived === "number");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("default config uses sensible defaults", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleaner-defaults-"));
    const cleaner = createMemoryCleaner(tmpDir, mockDb());
    assert.strictEqual(cleaner.validateConfig(), null, "Default 30-day retention should be fine");
    const result = cleaner.cleanup();
    assert.ok(result.deleted >= 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
