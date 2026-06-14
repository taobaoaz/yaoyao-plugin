/**
 * Regression test for memory_forget / forget/tool.ts — empty rollback loop.
 *
 * Before the fix: when fs.writeFileSync failed for some file N, the catch
 * block contained a for-loop over modifiedFiles.slice(0, -1) with an
 * EMPTY body and only a comment. The loop did nothing; the comment
 * admitted "这里没有原始内容备份，无法真正回滚". This is dead code that
 * gave a false sense of safety.
 *
 * After the fix: the dead loop is gone, and the error message explicitly
 * lists which files were modified before the failure, so the user knows
 * what to restore from .backups/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createForgetTool } from "../features/forget/tool.ts";
import type { MemoryStore } from "../utils/memory-store.ts";
import type { DBBridge } from "../utils/db-bridge.ts";

/**
 * Build a MemoryStore mock where listFiles returns a sequence of daily
 * entries. The last entry's `path` is unwritable (we mark it via
 * fs.chmod 0o444 on a *file* that the mock owns, so fs.writeFileSync
 * will fail with EACCES on POSIX hosts).
 *
 * On Windows, chmod 0o444 is a no-op (write is still allowed for the
 * owner). For Windows we use a fallback: readFile returns content so the
 * loop proceeds, but the entry's path is deliberately invalid (a path
 * whose parent directory does not exist) so fs.writeFileSync throws
 * ENOENT.
 */
function buildMockStore(opts: {
  writableFilePaths: string[];
  contents: Record<string, string>;
  unwritableEntry: { path: string; date: string };
  baseDir: string;
}): MemoryStore {
  const entries = [
    ...opts.writableFilePaths.map(p => ({
      type: "daily" as const,
      path: p,
      filename: path.basename(p),
      date: path.basename(p, ".md"),
      size: fs.statSync(p).size,
      modified: fs.statSync(p).mtimeMs,
      importance: 0.5,
    })),
    {
      type: "daily" as const,
      path: opts.unwritableEntry.path,
      filename: path.basename(opts.unwritableEntry.path),
      date: opts.unwritableEntry.date,
      size: 100,
      modified: Date.now(),
      importance: 0.5,
    },
  ];
  return {
    baseDir: opts.baseDir,
    workspaceDir: opts.baseDir,
    dbPath: "/tmp/yaoyao.db",
    ensureDir: () => {},
    getDailyFile: () => "",
    appendToDaily: () => {},
    readFile: (p: string) => opts.contents[p] ?? null,
    listFiles: () => entries,
    dailyFilePath: (date?: string) => path.join(opts.baseDir, `${date || "today"}.md`),
    readWorkspaceFile: () => null,
    appendToWorkspaceFile: () => true,
    writeWorkspaceFile: () => true,
  } as unknown as MemoryStore;
}

function buildMockDb(): DBBridge {
  return {
    deleteByKeyword: (_q: string) => 0,
    deleteByDate: (_d: string) => 0,
  } as unknown as DBBridge;
}

test("forget surfaces the modified-files list when write fails mid-loop", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-forget-"));
  try {
    const fileA = path.join(dir, "2026-06-13.md");
    const fileB = path.join(dir, "2026-06-14.md");
    fs.writeFileSync(fileA, "### 2026-06-13 10:00:00\n**User:** foo keyword here\n**AI:** ok\n", "utf-8");
    fs.writeFileSync(fileB, "### 2026-06-14 10:00:00\n**User:** bar keyword here\n**AI:** ok\n", "utf-8");

    // Make fileB read-only so fs.writeFileSync will fail with EACCES
    // on POSIX. On Windows, chmod is a no-op for the owner; we rely on
    // the fallback path below.
    try { fs.chmodSync(fileB, 0o444); } catch { /* ignore on Windows */ }

    // Windows fallback: simulate a path whose parent does not exist.
    const unwritablePath = process.platform === "win32"
      ? path.join(dir, "does-not-exist", "2026-06-15.md")
      : fileB;
    const unwritableDate = "2026-06-15";

    const contents: Record<string, string> = {
      [fileA]: fs.readFileSync(fileA, "utf-8"),
      [unwritablePath]: "### 2026-06-15 10:00:00\n**User:** baz keyword here\n**AI:** ok\n",
    };

    const store = buildMockStore({
      writableFilePaths: [fileA],
      contents,
      unwritableEntry: { path: unwritablePath, date: unwritableDate },
      baseDir: dir,
    });
    const db = buildMockDb();
    const tool = createForgetTool(store, db);

    const result = await tool.execute("test-id", { query: "keyword" });
    const text = result.content[0].text;

    // After the fix the message must include the modified-files list.
    assert.ok(text.includes("已修改"), `Expected error message to mention modified files. Got: ${text}`);
    // The "do not delete index" guarantee must remain.
    assert.ok(text.includes("未删除索引"), `Expected "未删除索引" guarantee. Got: ${text}`);
  } finally {
    try { fs.chmodSync(path.join(dir, "2026-06-14.md"), 0o644); } catch { /* ignore */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});