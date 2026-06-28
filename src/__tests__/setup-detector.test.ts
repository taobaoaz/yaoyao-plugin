/**
 * Tests for features/setup — detector + state (v1.9.1).
 *
 * Covers the core guidance logic: what triggers a finding, what makes a state
 * "ready", and the signature-based dedup that prevents re-nagging.
 *
 * Run: node --test src/__tests__/setup-detector.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSetup } from "../features/setup/detector.ts";
import type { CapabilityReport } from "../utils/install-check.ts";
import {
  computeGuidanceSignature,
  isGuidanceShown,
  markGuidanceShown,
  clearGuidanceMarker,
} from "../features/setup/state.ts";

const baseCap: CapabilityReport = {
  canRun: true,
  backend: "node-sqlite",
  features: { fts5: true, wal: true, vec: true, autoCapture: true, autoRecall: true },
  warnings: [],
  info: [],
};

function makeInput(overrides = {}) {
  return {
    coexistMode: "standalone" as const,
    slotOwner: "",
    embeddingEnabled: false,
    llmEnabled: true,
    cap: baseCap,
    memoryDir: "/tmp",
    memoryCount: 5,
    ...overrides,
  };
}

describe("detectSetup: standalone ready", () => {
  it("is ready when standalone + has data + vector on + no warnings", () => {
    const state = detectSetup(makeInput({
      embeddingEnabled: true,
      memoryCount: 10,
    }));
    assert.strictEqual(state.ready, true);
    assert.strictEqual(state.findings.length, 0);
  });
});

describe("detectSetup: coexist without bridge", () => {
  it("flags a tip when coexist and celiaBridge not enabled", () => {
    const state = detectSetup(makeInput({
      coexistMode: "coexist",
      slotOwner: "memory-celia",
      celiaBridge: { enabled: false },
    }));
    assert.strictEqual(state.mode, "coexist");
    const f = state.findings.find((x) => x.id === "coexist-no-bridge");
    assert.ok(f, "expected coexist-no-bridge finding");
    assert.strictEqual(f!.severity, "tip");
    assert.ok(f!.action.includes("celiaBridge"));
  });

  it("does NOT flag when coexist and bridge IS enabled", () => {
    const state = detectSetup(makeInput({
      coexistMode: "coexist",
      slotOwner: "memory-celia",
      celiaBridge: { enabled: true, mode: "delegate" },
      embeddingEnabled: true,
    }));
    assert.strictEqual(state.findings.find((x) => x.id === "coexist-no-bridge"), undefined);
  });
});

describe("detectSetup: empty memory", () => {
  it("flags empty-memory tip when count is 0", () => {
    const state = detectSetup(makeInput({ memoryCount: 0, embeddingEnabled: true }));
    assert.ok(state.findings.find((x) => x.id === "empty-memory"));
  });
});

describe("detectSetup: vector not enabled", () => {
  it("flags no-vector tip when embedding off and backend supports it", () => {
    const state = detectSetup(makeInput({ embeddingEnabled: false, memoryCount: 5 }));
    assert.ok(state.findings.find((x) => x.id === "no-vector"));
  });

  it("does NOT flag no-vector on file-db backend (vectors impossible anyway)", () => {
    const fileCap: CapabilityReport = { ...baseCap, backend: "file-db" };
    const state = detectSetup(makeInput({ cap: fileCap, embeddingEnabled: false, memoryCount: 5 }));
    assert.strictEqual(state.findings.find((x) => x.id === "no-vector"), undefined);
  });
});

describe("detectSetup: capability warnings", () => {
  it("surfaces cap warnings as warn findings", () => {
    const warnCap: CapabilityReport = { ...baseCap, warnings: ["Node 版本过低"] };
    const state = detectSetup(makeInput({ cap: warnCap, embeddingEnabled: true, memoryCount: 5 }));
    const warns = state.findings.filter((x) => x.severity === "warn");
    assert.ok(warns.length >= 1);
    assert.ok(warns[0].detail.includes("Node 版本过低"));
  });
});

describe("guidance state: signature dedup", () => {
  let dir: string;
  before(() => { dir = mkdtempSync(join(tmpdir(), "yao-setup-")); });
  after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* win */ } });

  const sigA = computeGuidanceSignature({
    mode: "coexist", slotOwner: "memory-celia",
    bridgeEnabled: false, bridgeMode: "", embeddingEnabled: false, memoryEmpty: true,
  });
  const sigB = computeGuidanceSignature({
    mode: "coexist", slotOwner: "memory-celia",
    bridgeEnabled: true, bridgeMode: "delegate", embeddingEnabled: false, memoryEmpty: true,
  });

  it("returns not-shown before marking", () => {
    assert.strictEqual(isGuidanceShown(dir, sigA, "1.9.1"), false);
  });

  it("returns shown after marking for the same signature", () => {
    markGuidanceShown(dir, sigA, "1.9.1");
    assert.strictEqual(isGuidanceShown(dir, sigA, "1.9.1"), true);
  });

  it("returns not-shown for a different signature (config changed)", () => {
    markGuidanceShown(dir, sigA, "1.9.1");
    assert.strictEqual(isGuidanceShown(dir, sigB, "1.9.1"), false);
  });

  it("clearGuidanceMarker resets to not-shown", () => {
    markGuidanceShown(dir, sigA, "1.9.1");
    clearGuidanceMarker(dir);
    assert.strictEqual(isGuidanceShown(dir, sigA, "1.9.1"), false);
  });
});
