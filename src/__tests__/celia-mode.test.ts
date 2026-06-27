/**
 * Tests for celia/mode.ts — celiaBridge.mode normalization (v1.9.1).
 *
 * Guards the fix for the config-guide spelling mismatch: "readonly" (no hyphen)
 * must route to the read-only branch just like "read-only".
 *
 * Run: node --test src/__tests__/celia-mode.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeBridgeMode } from "../celia/mode.ts";

describe("normalizeBridgeMode", () => {
  it("maps 'readonly' (shorthand, no hyphen) to readonly", () => {
    assert.strictEqual(normalizeBridgeMode("readonly"), "readonly");
  });

  it("maps 'read-only' (canonical) to readonly", () => {
    assert.strictEqual(normalizeBridgeMode("read-only"), "readonly");
  });

  it("maps 'read_only' (underscore variant) to readonly", () => {
    assert.strictEqual(normalizeBridgeMode("read_only"), "readonly");
  });

  it("is case-insensitive", () => {
    assert.strictEqual(normalizeBridgeMode("ReadOnly"), "readonly");
    assert.strictEqual(normalizeBridgeMode("READ-ONLY"), "readonly");
    assert.strictEqual(normalizeBridgeMode("  Read-Only  "), "readonly");
  });

  it("maps 'delegate' (canonical) to delegate", () => {
    assert.strictEqual(normalizeBridgeMode("delegate"), "delegate");
  });

  it("defaults to delegate for undefined/null/empty", () => {
    assert.strictEqual(normalizeBridgeMode(undefined), "delegate");
    assert.strictEqual(normalizeBridgeMode(null), "delegate");
    assert.strictEqual(normalizeBridgeMode(""), "delegate");
  });

  it("defaults unknown values to delegate (safe full-featured path)", () => {
    assert.strictEqual(normalizeBridgeMode("something-weird"), "delegate");
    assert.strictEqual(normalizeBridgeMode("off"), "delegate");
  });
});
