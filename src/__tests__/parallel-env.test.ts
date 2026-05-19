/**
 * __tests__/parallel-env.test.ts — 验证通用路径与小艺路径并行隔离
 * 
 * 使用子进程隔离环境变量和文件系统
 */

import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to run detection in isolated subprocess
function runDetection(env: Record<string, string | undefined>): { env: string; confidence: string; signals: string[] } {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "-e",
      `
        import { detectEnvironment } from "${join(__dirname, "../utils/environment-detector.ts").replace(/\\/g, "/")}";
        console.log(JSON.stringify(detectEnvironment()));
      `
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: "/tmp/fake-home", // Fake home to avoid ~/.openclaw/openclaw.json
        ...env,
      },
      encoding: "utf8",
      cwd: "/tmp", // Run from /tmp to avoid current dir signals
    }
  );

  if (result.status !== 0) {
    throw new Error(`Subprocess failed: ${result.stderr}`);
  }

  const lines = result.stdout.trim().split("\n");
  const jsonLine = lines.find(l => l.startsWith("{"));
  if (!jsonLine) {
    throw new Error(`No JSON output found. stdout: ${result.stdout}`);
  }

  return JSON.parse(jsonLine);
}

test("parallel environment isolation", async (t) => {
  await t.test("generic path does not load xiaoyi adapter", () => {
    const result = runDetection({
      OPENCLAW_HOME: "/tmp/fake-openclaw",
      // Ensure no xiaoyi signals
      XIAOYI_CLAW_HOME: undefined,
      XIAOYI_CLAW_VERSION: undefined,
    });

    assert.strictEqual(result.env, "openclaw", "should detect openclaw");
    assert.strictEqual(result.confidence, "high", "confidence should be high");
  });

  await t.test("xiaoyi path does not interfere with generic features", () => {
    const result = runDetection({
      XIAOYI_CLAW_HOME: "/tmp/fake-xiaoyi",
      // Ensure no openclaw signals that would win
      OPENCLAW_HOME: undefined,
      OPENCLAW_CONFIG_PATH: undefined,
    });

    assert.strictEqual(result.env, "xiaoyi-claw", "should detect xiaoyi");
    assert.strictEqual(result.confidence, "high", "confidence should be high");
  });

  await t.test("unknown environment falls back to generic", () => {
    const result = runDetection({
      // Clear ALL signals
      OPENCLAW_HOME: undefined,
      OPENCLAW_CONFIG_PATH: undefined,
      XIAOYI_CLAW_HOME: undefined,
      XIAOYI_CLAW_VERSION: undefined,
      XIAOYI_WORKER_ID: undefined,
      ZMQ_PUB_ENDPOINT: undefined,
    });

    assert.strictEqual(result.env, "unknown", "should be unknown");
    assert.strictEqual(result.confidence, "low", "confidence should be low");
  });

  await t.test("both paths can coexist - xiaoyi wins by priority", () => {
    const result = runDetection({
      // Set BOTH signals
      OPENCLAW_HOME: "/tmp/fake-openclaw",
      XIAOYI_CLAW_HOME: "/tmp/fake-xiaoyi",
      // No config files or fs signatures in fake paths
    });

    // XIAOYI_CLAW_HOME is checked before OPENCLAW_HOME in detectByEnvVars
    assert.strictEqual(result.env, "xiaoyi-claw", "xiaoyi should win by priority");
    assert.strictEqual(result.confidence, "high", "confidence should be high");
  });
});
