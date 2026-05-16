import { evaluateTier, evaluateAllTiers, DEFAULT_TIER_CONFIG, type TierableMemory } from "../utils/tier-manager.ts";
import { describe, it } from "node:test";
import assert from "node:assert";

function makeMemory(p: Partial<TierableMemory> & { id: string }): TierableMemory {
  return {
    tier: "peripheral",
    importance: 0.5,
    accessCount: 0,
    createdAt: Date.now() - 86400000,
    decayScore: 0.5,
    ...p,
  };
}

describe("evaluateTier", () => {
  it("promotes peripheral → working on high access + decay", () => {
    const m = makeMemory({ id: "1", tier: "peripheral", accessCount: 5, decayScore: 0.5 });
    const t = evaluateTier(m, DEFAULT_TIER_CONFIG);
    assert.notStrictEqual(t, null);
    assert.strictEqual(t!.toTier, "working");
  });

  it("promotes working → core on high access + decay + importance", () => {
    const m = makeMemory({ id: "2", tier: "working", accessCount: 12, decayScore: 0.8, importance: 0.9 });
    const t = evaluateTier(m, DEFAULT_TIER_CONFIG);
    assert.notStrictEqual(t, null);
    assert.strictEqual(t!.toTier, "core");
  });

  it("demotes core → working on low decay", () => {
    const m = makeMemory({ id: "3", tier: "core", accessCount: 5, decayScore: 0.5 });
    const t = evaluateTier(m, DEFAULT_TIER_CONFIG);
    assert.notStrictEqual(t, null);
    assert.strictEqual(t!.toTier, "working");
  });

  it("demotes working → peripheral on low decay", () => {
    const m = makeMemory({ id: "4", tier: "working", accessCount: 1, decayScore: 0.1 });
    const t = evaluateTier(m, DEFAULT_TIER_CONFIG);
    assert.notStrictEqual(t, null);
    assert.strictEqual(t!.toTier, "peripheral");
  });

  it("returns null when no transition needed", () => {
    const m = makeMemory({ id: "5", tier: "peripheral", accessCount: 1, decayScore: 0.2 });
    assert.strictEqual(evaluateTier(m, DEFAULT_TIER_CONFIG), null);
  });
});

describe("evaluateAllTiers", () => {
  it("returns multiple transitions", () => {
    const memories = [
      makeMemory({ id: "a", tier: "peripheral", accessCount: 5, decayScore: 0.5 }),
      makeMemory({ id: "b", tier: "working", accessCount: 12, decayScore: 0.8, importance: 0.9 }),
    ];
    const transitions = evaluateAllTiers(memories);
    assert.strictEqual(transitions.length, 2);
    assert.strictEqual(transitions[0].toTier, "working");
    assert.strictEqual(transitions[1].toTier, "core");
  });
});
