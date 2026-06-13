/**
 * Tests for intent-analyzer.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { analyzeIntent, applyCategoryBoost } from "../utils/intent-analyzer.ts";

describe("analyzeIntent", () => {
  it("returns empty for empty query", () => {
    const signal = analyzeIntent("");
    assert.strictEqual(signal.label, "empty");
    assert.strictEqual(signal.confidence, "low");
  });

  it("detects preference intent", () => {
    const signal = analyzeIntent("What's my preferred style?");
    assert.strictEqual(signal.label, "preference");
    assert.deepStrictEqual(signal.categories, ["preference", "decision"]);
    assert.strictEqual(signal.confidence, "high");
  });

  it("detects decision intent", () => {
    const signal = analyzeIntent("Why did we choose this approach?");
    assert.strictEqual(signal.label, "decision");
    assert.deepStrictEqual(signal.categories, ["decision", "fact"]);
  });

  it("detects entity intent", () => {
    const signal = analyzeIntent("Who is the team lead?");
    assert.strictEqual(signal.label, "entity");
    assert.deepStrictEqual(signal.categories, ["entity", "fact"]);
  });

  it("detects event intent", () => {
    const signal = analyzeIntent("What happened last week?");
    assert.strictEqual(signal.label, "event");
    assert.deepStrictEqual(signal.categories, ["entity", "decision"]);
    assert.strictEqual(signal.depth, "full");
  });

  it("detects fact intent", () => {
    const signal = analyzeIntent("How does the API work?");
    assert.strictEqual(signal.label, "fact");
    assert.deepStrictEqual(signal.categories, ["fact", "entity"]);
  });

  it("returns broad for unknown", () => {
    const signal = analyzeIntent("hello");
    assert.strictEqual(signal.label, "broad");
  });
});

describe("applyCategoryBoost", () => {
  it("returns unchanged for broad intent", () => {
    const results = [
      { entry: { category: "preference" }, score: 0.5 },
      { entry: { category: "fact" }, score: 0.6 },
    ];
    const boosted = applyCategoryBoost(results, { categories: [], confidence: "low", label: "broad", depth: "l0" });
    assert.strictEqual(boosted[0].score, 0.5);
  });

  it("boosts matching categories", () => {
    const results = [
      { entry: { category: "preference" }, score: 0.5 },
      { entry: { category: "fact" }, score: 0.6 },
    ];
    const intent = { categories: ["preference" as const], confidence: "high" as const, label: "preference", depth: "l0" as const };
    const boosted = applyCategoryBoost(results, intent);
    assert.ok(boosted[0].score > 0.5); // preference boosted
  });
});
