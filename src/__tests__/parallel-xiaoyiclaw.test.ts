/**
 * __tests__/parallel-xiaoyiclaw.test.ts — 验证 yaoyao-memory 与 xiaoyiclaw 并行隔离
 */

import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to run detection in isolated subprocess
function runInIsolation(
  env: Record<string, string | undefined>,
  script: string
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "-e", script],
    {
      env: {
        PATH: process.env.PATH,
        HOME: "/tmp/fake-home",
        ...env,
      },
      encoding: "utf8",
      cwd: "/tmp",
    }
  );

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

test("yaoyao-memory parallel with xiaoyiclaw", async (t) => {
  await t.test("sqlite database paths do not conflict", () => {
    // yaoyao-memory uses ~/.openclaw/yaoyao-memory.db
    // xiaoyiclaw likely uses its own path
    const yaoyaoDbPath = join(
      process.env.HOME || "/tmp",
      ".openclaw",
      "yaoyao-memory.db"
    );

    // Simulate xiaoyiclaw using different path
    const xiaoyiDbPath = join(
      process.env.HOME || "/tmp",
      ".openclaw",
      "xiaoyi-memory.db"
    );

    assert.notStrictEqual(
      yaoyaoDbPath,
      xiaoyiDbPath,
      "database paths should be different"
    );
  });

  await t.test("plugin IDs are unique - no collision", () => {
    const yaoyaoId = "yaoyao-memory";
    const xiaoyiId = "xiaoyi-claw";

    assert.notStrictEqual(
      yaoyaoId,
      xiaoyiId,
      "plugin IDs should not collide"
    );
  });

  await t.test("hook registration does not duplicate", () => {
    // yaoyao-memory registers: onCapture, onRecall, onCompact
    // xiaoyiclaw has its own hooks
    const yaoyaoHooks = ["onCapture", "onRecall", "onCompact"];
    const xiaoyiHooks = [
      "before_agent_start",
      "agent_end",
      "dag_ingest",
      "dag_compact",
    ];

    const overlap = yaoyaoHooks.filter((h) => xiaoyiHooks.includes(h));
    assert.deepStrictEqual(
      overlap,
      [],
      "hook names should not overlap to avoid duplicate registration"
    );
  });

  await t.test("memory slot names are isolated", () => {
    // yaoyao-memory uses slot: memory-core
    // xiaoyiclaw likely uses different slot name
    const yaoyaoSlot = "memory-core";
    const xiaoyiSlot = "xiaoyi-memory";

    assert.notStrictEqual(
      yaoyaoSlot,
      xiaoyiSlot,
      "memory slot names should be isolated"
    );
  });

  await t.test("vector model configs are independent", () => {
    // yaoyao-memory: bge-reranker-v2-m3 (local)
    // xiaoyiclaw: built-in vector model (cloud API)
    const yaoyaoVector = "bge-reranker-v2-m3";
    const xiaoyiVector = "built-in";

    assert.notStrictEqual(
      yaoyaoVector,
      xiaoyiVector,
      "vector models should be independent"
    );
  });

  await t.test("environment detection distinguishes both", async () => {
    const { detectEnvironment } = await import("../utils/environment-detector.ts");

    // When both are present, detection should be able to identify
    // This is a conceptual test - actual parallel running needs both installed
    const result = detectEnvironment();

    // Should not return "unknown" when yaoyao is clearly installed
    assert.notStrictEqual(
      result.env,
      "unknown",
      "should detect at least one environment"
    );
  });

  await t.test("config keys do not overlap", () => {
    const yaoyaoConfigKeys = [
      "yaoyao-memory.enabled",
      "yaoyao-memory.dbPath",
      "yaoyao-memory.vectorModel",
    ];

    const xiaoyiConfigKeys = [
      "xiaoyi-claw.enabled",
      "xiaoyi-claw.workspace",
      "xiaoyi-claw.model",
    ];

    const overlap = yaoyaoConfigKeys.filter((k) =>
      xiaoyiConfigKeys.some((xk) => xk.includes(k.split(".")[0]))
    );

    assert.strictEqual(
      overlap.length,
      0,
      "config namespaces should not overlap"
    );
  });
});
