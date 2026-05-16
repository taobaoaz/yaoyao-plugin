/**
 * Tests for auto-recall-tier1.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { isSuppressed, computeTier1Patch, TIER1_BAD_RECALL_SUPPRESSION_THRESHOLD } from "../utils/auto-recall-tier1.ts";

describe("isSuppressed", () => {
  it("returns false when no suppression", () => {
    assert.strictEqual(isSuppressed({}, Date.now()), false);
  });

  it("returns true when suppressed", () => {
    const now = Date.now();
    assert.strictEqual(isSuppressed({ suppressed_until_ms: now + 60000 }, now), true);
  });

  it("returns false when suppression expired", () => {
    const now = Date.now();
    assert.strictEqual(isSuppressed({ suppressed_until_ms: now - 60000 }, now), false);
  });
});

describe("computeTier1Patch", () => {
  it("increments access and injected counts", () => {
    const patch = computeTier1Patch(
      { access_count: 2, injected_count: 1 },
      { injectedAt: 1700000000000 },
    );
    assert.strictEqual(patch.access_count, 3);
    assert.strictEqual(patch.injected_count, 2);
    assert.strictEqual(patch.last_injected_at, 1700000000000);
  });

  it("lazy heals legacy pollution", () => {
    const patch = computeTier1Patch(
      { bad_recall_count: 5, suppressed_until_turn: 3 },
      { injectedAt: 1700000000000 },
    );
    assert.strictEqual(patch.bad_recall_count, 0);
    assert.strictEqual(patch.suppressed_until_turn, 0);
  });

  it("decays bad_recall after long gap", () => {
    const now = 1700000000000;
    const oldInjected = now - 25 * 60 * 60 * 1000; // 25h ago
    const patch = computeTier1Patch(
      { bad_recall_count: 2, last_injected_at: oldInjected, last_confirmed_use_at: oldInjected, suppressed_until_ms: 0 },
      { injectedAt: now, badRecallDecayMs: 24 * 60 * 60 * 1000 },
    );
    assert.strictEqual(patch.bad_recall_count, 0);
  });

  it("increments bad_recall on stale injection", () => {
    const oldInjected = 1700000000000 - 1000;
    const patch = computeTier1Patch(
      { bad_recall_count: 0, last_injected_at: oldInjected },
      { injectedAt: 1700000000000 },
    );
    assert.strictEqual(patch.bad_recall_count, 1);
  });

  it("suppresses when threshold reached", () => {
    const now = 1700000000000;
    const patch = computeTier1Patch(
      {
        bad_recall_count: TIER1_BAD_RECALL_SUPPRESSION_THRESHOLD - 1,
        last_injected_at: now - 1000,
        suppressed_until_ms: 0, // avoid lazy heal
      },
      { injectedAt: now, minRepeated: 1 },
    );
    assert.ok(patch.suppressed_until_ms > now);
  });
});
