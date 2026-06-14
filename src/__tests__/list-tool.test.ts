/**
 * Regression tests for the list/tool sort-by-score no-op (audit Bug #6).
 *
 * Before the fix, listFiles() in memory-store.ts did NOT populate the
 * `importance` field on MemoryEntry, so the list/tool sort-by-score option
 * was a silent no-op (comparator always returned 0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemoryStore } from "../utils/memory-store.ts";
import { createListTool } from "../features/list/tool.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store-types.ts";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-list-test-"));
}

function rmTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeConfig(memoryDir: string): YaoyaoMemoryConfig {
  return { memoryDir } as YaoyaoMemoryConfig;
}

test("listFiles populates importance on every entry", () => {
  const dir = mkTempDir();
  try {
    const store = createMemoryStore(makeConfig(dir));
    fs.writeFileSync(path.join(dir, "2026-06-13.md"), "x".repeat(5000), "utf-8");
    fs.writeFileSync(path.join(dir, "2026-06-14.md"), "x".repeat(50000), "utf-8");

    const files = store.listFiles();
    assert.equal(files.length, 2);
    for (const f of files) {
      assert.equal(typeof f.importance, "number", `importance should be a number, got ${f.importance}`);
      assert.ok(f.importance! >= 0 && f.importance! <= 1, `importance ${f.importance} should be in [0, 1]`);
    }
  } finally {
    rmTempDir(dir);
  }
});

test("list/tool sort by score actually orders by importance", async () => {
  const dir = mkTempDir();
  try {
    const store = createMemoryStore(makeConfig(dir));
    const oldPath = path.join(dir, "2020-01-01.md");
    const newPath = path.join(dir, "2026-06-14.md");
    fs.writeFileSync(oldPath, "tiny", "utf-8");
    fs.writeFileSync(newPath, "y".repeat(100_000), "utf-8");
    const oldDate = new Date("2020-01-01T00:00:00Z");
    fs.utimesSync(oldPath, oldDate, oldDate);
    fs.utimesSync(newPath, new Date(), new Date());

    const tool = createListTool(store);
    const result = await tool.execute("test", { sort: "score" }) as { content: Array<{ text: string }> };
    const text = result.content[0].text;
    const newIdx = text.indexOf("2026-06-14.md");
    const oldIdx = text.indexOf("2020-01-01.md");
    assert.ok(newIdx > -1 && oldIdx > -1, "both files should appear in output");
    assert.ok(newIdx < oldIdx, `newer+larger file should sort first by score; got newIdx=${newIdx}, oldIdx=${oldIdx}`);
  } finally {
    rmTempDir(dir);
  }
});
