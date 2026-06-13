import { describe, it } from "node:test";
import assert from "node:assert";
import { recordInvocation, getTopPatterns, getToolStats } from "../core/skills/tracker.ts";
import { analyzeSkills } from "../core/skills/analyzer.ts";

describe("skill tracking", () => {
  it("records invocations and detects patterns", () => {
    recordInvocation({
      id: "1",
      toolId: "memory_search",
      params: { query: "test" },
      durationMs: 100,
      timestamp: Date.now(),
    });
    recordInvocation({
      id: "2",
      toolId: "memory_search",
      params: { query: "test2" },
      durationMs: 150,
      timestamp: Date.now(),
    });

    const patterns = getTopPatterns(5);
    assert.ok(patterns.length > 0);
    assert.strictEqual(patterns[0].toolId, "memory_search");
    assert.strictEqual(patterns[0].frequency, 2);
  });

  it("calculates tool stats", () => {
    const stats = getToolStats("memory_search");
    assert.notStrictEqual(stats, null);
    assert.ok(stats!.count > 0);
    assert.ok(stats!.avgDurationMs > 0);
  });

  it("returns null for unused tools", () => {
    const stats = getToolStats("nonexistent_tool");
    assert.strictEqual(stats, null);
  });
});

describe("skill analysis", () => {
  it("generates suggestions based on patterns", () => {
    const suggestions = analyzeSkills();
    assert.ok(Array.isArray(suggestions));
  });
});
