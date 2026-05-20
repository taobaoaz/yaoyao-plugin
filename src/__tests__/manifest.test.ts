import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initManifest, readManifest, recordSeedRun, recordOperation } from "../utils/manifest.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaoyao-manifest-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("manifest", () => {
  it("creates manifest on first call", () => {
    const m = initManifest(tmpDir, "1.5.1-beta1");
    assert.strictEqual(m.pluginVersion, "1.7.3");
    assert.ok(m.firstInitAt);
    assert.strictEqual(m.storeBackend, "sqlite");
    assert.strictEqual(m.seedRunCount, 0);
  });

  it("updates lastOperation on second call", () => {
    const m1 = initManifest(tmpDir, "1.5.1-beta1");
    const m2 = initManifest(tmpDir, "1.5.1-beta1");
    assert.strictEqual(m2.lastOperationType, "startup");
    assert.strictEqual(m2.firstInitAt, m1.firstInitAt);
  });

  it("returns null if not exists", () => {
    assert.strictEqual(readManifest(tmpDir), null);
  });

  it("recordSeedRun increments count", () => {
    initManifest(tmpDir, "1.0.0");
    recordSeedRun(tmpDir, 50);
    const m = readManifest(tmpDir);
    assert.strictEqual(m?.seedRunCount, 1);
    assert.strictEqual(m?.totalEntries, 50);
    assert.strictEqual(m?.lastOperationType, "seed:50");
  });

  it("recordOperation updates lastOperationType", () => {
    initManifest(tmpDir, "1.0.0");
    recordOperation(tmpDir, "cleanup");
    const m = readManifest(tmpDir);
    assert.strictEqual(m?.lastOperationType, "cleanup");
  });
});
