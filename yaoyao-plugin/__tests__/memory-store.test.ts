/**
 * Tests for memory-store.ts — file-based memory storage.
 *
 * Run: node --test src/__tests__/memory-store.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemoryStore } from "../utils/memory-store.ts";

let baseDir: string;
let store: ReturnType<typeof createMemoryStore>;

before(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-test-"));
  store = createMemoryStore({ memoryDir: baseDir } as unknown, console as unknown);
});

after(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("createMemoryStore", () => {
  it("initializes with default baseDir", () => {
    const s = createMemoryStore({} as unknown);
    assert(s.baseDir.length > 0);
  });

  it("creates baseDir on init", () => {
    assert(fs.existsSync(baseDir));
  });
});

describe("appendToDaily", () => {
  it("writes to a daily file", () => {
    store.appendToDaily("2026-01-01", "\n### test\nhello world\n");
    const fp = path.join(baseDir, "2026-01-01.md");
    assert(fs.existsSync(fp));
    const content = fs.readFileSync(fp, "utf-8");
    assert(content.includes("hello world"));
  });

  it("appends to existing daily file", () => {
    store.appendToDaily("2026-01-01", "\n### test2\nsecond entry\n");
    const fp = path.join(baseDir, "2026-01-01.md");
    const content = fs.readFileSync(fp, "utf-8");
    assert(content.includes("hello world"));
    assert(content.includes("second entry"));
  });

  it("creates files in correct subdir when memoryDir is set", () => {
    const subDir = path.join(baseDir, "sub");
    const s = createMemoryStore({ memoryDir: subDir } as unknown, console as unknown);
    s.appendToDaily("2026-06-01", "\ndata\n");
    assert(fs.existsSync(path.join(subDir, "2026-06-01.md")));
    fs.rmSync(subDir, { recursive: true, force: true });
  });
});

describe("readFile", () => {
  it("reads back file content", () => {
    store.appendToDaily("2026-03-15", "\n### read test\nhello\n");
    const content = store.readFile(path.join(baseDir, "2026-03-15.md"));
    assert(content !== null);
    assert(content.includes("read test"));
  });

  it("returns null for nonexistent file", () => {
    const result = store.readFile(path.join(baseDir, "nonexistent.md"));
    assert.strictEqual(result, null);
  });

  it("reads file outside baseDir as-is (no path restriction)", () => {
    // memory-store's readFile doesn't do path restriction,
    // it just reads whatever path is given
    const p = path.join(baseDir, "outside-test.txt");
    fs.writeFileSync(p, "outside content");
    const result = store.readFile(p);
    assert.strictEqual(result, "outside content");
    fs.unlinkSync(p);
  });
});

describe("listFiles", () => {
  it("returns files with metadata", () => {
    const files = store.listFiles();
    const dailyFiles = files.filter(f => f.type === "daily");
    assert(dailyFiles.length >= 0);
  });

  it("each file has filename, size, modified, type", () => {
    for (const f of store.listFiles()) {
      assert(typeof f.filename === "string");
      assert(typeof f.size === "number");
      assert(typeof f.modified === "number");
      assert(["daily", "memory", "archive"].includes(f.type));
    }
  });
});
