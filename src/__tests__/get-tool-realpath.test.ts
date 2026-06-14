/**
 * Regression test for memory_get / get/tool.ts — fs.realpathSync(baseDir)
 * on a fresh install where the memory dir does not exist yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemoryStore } from "../utils/memory-store.ts";
import { createGetTool } from "../features/get/tool.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store-types.ts";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-get-realpath-"));
}

function makeConfig(memoryDir: string): YaoyaoMemoryConfig {
  return { memoryDir } as YaoyaoMemoryConfig;
}

test("memory_get does not crash when baseDir does not exist", async () => {
  const parentDir = mkTempDir();
  const freshDir = path.join(parentDir, "never-existed");
  try {
    const store = createMemoryStore(makeConfig(freshDir));
    assert.equal(fs.existsSync(freshDir), false);

    const tool = createGetTool(store, {} as never);
    const result = await tool.execute("test-id", { path: "2026-01-01.md" });

    assert.ok(Array.isArray(result.content));
    const text = result.content[0].text;
    assert.ok(
      !text.startsWith("❌ 记忆操作出错: ENOENT"),
      `memory_get should not surface ENOENT from realpathSync. Got: ${text}`
    );
    assert.ok(
      text.includes("文件未找到") ||
        text.includes("拒绝读取") ||
        text.includes("不存在") ||
        text.includes("no such file"),
      `Expected graceful file-not-found or path-rejection. Got: ${text}`
    );
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

test("memory_get rejects paths outside baseDir even when baseDir exists", async () => {
  const dir = mkTempDir();
  try {
    const store = createMemoryStore(makeConfig(dir));
    fs.writeFileSync(path.join(dir, "real.md"), "hello", "utf-8");

    const tool = createGetTool(store, {} as never);
    const outOfBounds = path.join(os.tmpdir(), "definitely-outside-yaoyao.txt");
    fs.writeFileSync(outOfBounds, "secret", "utf-8");
    try {
      const result = await tool.execute("test-id", { path: outOfBounds });
      const text = result.content[0].text;
      assert.ok(text.includes("拒绝读取"), `Expected rejection. Got: ${text}`);
    } finally {
      fs.rmSync(outOfBounds, { force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_get returns file content when path is under baseDir", async () => {
  const dir = mkTempDir();
  try {
    const store = createMemoryStore(makeConfig(dir));
    fs.writeFileSync(path.join(dir, "2026-06-14.md"), "test content", "utf-8");

    const tool = createGetTool(store, {} as never);
    const result = await tool.execute("test-id", { path: "2026-06-14.md" });
    const text = result.content[0].text;
    assert.ok(text.includes("test content"), `Expected file content. Got: ${text}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});