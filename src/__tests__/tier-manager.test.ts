import { evaluateTier, evaluateAllTiers, DEFAULT_TIER_CONFIG, type TierableMemory, TTL_DAYS_BY_MEMORY_TYPE, SUPPORTED_MEMORY_TYPES, getTtlDaysByType } from "../utils/tier-manager.ts";
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


describe("TTL_DAYS_BY_MEMORY_TYPE", () => {
  it("is frozen (immutable)", () => {
    assert.strictEqual(Object.isFrozen(TTL_DAYS_BY_MEMORY_TYPE), true);
  });
  it("contains all expected memory types", () => {
    for (const t of ["fact", "preference", "event", "entity", "goal", "relationship", "behavior", "general"]) {
      assert.ok(typeof TTL_DAYS_BY_MEMORY_TYPE[t] === "number", `missing TTL for ${t}`);
    }
  });
  it("events have shorter TTL than facts", () => {
    assert.ok(TTL_DAYS_BY_MEMORY_TYPE.event < TTL_DAYS_BY_MEMORY_TYPE.fact);
  });
});

describe("SUPPORTED_MEMORY_TYPES", () => {
  it("matches TTL_DAYS_BY_MEMORY_TYPE keys", () => {
    assert.deepStrictEqual(
      [...SUPPORTED_MEMORY_TYPES].sort(),
      Object.keys(TTL_DAYS_BY_MEMORY_TYPE).sort()
    );
  });
});

describe("getTtlDaysByType", () => {
  it("returns known type's TTL", () => {
    assert.strictEqual(getTtlDaysByType("fact"), 180);
    assert.strictEqual(getTtlDaysByType("event"), 30);
    assert.strictEqual(getTtlDaysByType("preference"), 60);
  });
  it("falls back to general for unknown types", () => {
    assert.strictEqual(getTtlDaysByType("nonsense_type"), TTL_DAYS_BY_MEMORY_TYPE.general);
  });
  it("handles null / undefined / empty string", () => {
    assert.strictEqual(getTtlDaysByType(null), TTL_DAYS_BY_MEMORY_TYPE.general);
    assert.strictEqual(getTtlDaysByType(undefined), TTL_DAYS_BY_MEMORY_TYPE.general);
    assert.strictEqual(getTtlDaysByType(""), TTL_DAYS_BY_MEMORY_TYPE.general);
  });
});
