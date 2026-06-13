import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyQuery } from "../core/adaptive/classify.ts";
import { resolveWeights, normalizeWeights } from "../core/adaptive/weights.ts";
import { QueryType } from "../core/adaptive/types.ts";

describe("query classification", () => {
  it("classifies temporal queries", () => {
    const result = classifyQuery("When did we last talk about this?");
    assert.strictEqual(result.type, QueryType.TEMPORAL);
    assert.ok(result.confidence > 0);
    assert.ok(result.keywords.length > 0);
  });

  it("classifies causal queries", () => {
    const result = classifyQuery("Why did the system fail?");
    assert.strictEqual(result.type, QueryType.CAUSAL);
    assert.ok(result.confidence > 0);
  });

  it("classifies entity queries", () => {
    const result = classifyQuery("Who is the project owner?");
    assert.strictEqual(result.type, QueryType.ENTITY);
    assert.ok(result.confidence > 0);
  });

  it("classifies conceptual queries", () => {
    const result = classifyQuery("What is the meaning of this?");
    assert.strictEqual(result.type, QueryType.CONCEPTUAL);
    assert.ok(result.confidence > 0);
  });

  it("returns unknown for empty queries", () => {
    const result = classifyQuery("");
    assert.strictEqual(result.type, QueryType.UNKNOWN);
  });
});

describe("weight resolution", () => {
  it("returns temporal weights for temporal queries", () => {
    const weights = resolveWeights({ type: QueryType.TEMPORAL, confidence: 0.8 });
    assert.ok(weights.temporal > weights.semantic);
  });

  it("returns causal weights for causal queries", () => {
    const weights = resolveWeights({ type: QueryType.CAUSAL, confidence: 0.8 });
    assert.ok(weights.graph > weights.semantic);
  });

  it("falls back to default for low confidence", () => {
    const weights = resolveWeights({ type: QueryType.TEMPORAL, confidence: 0.1 });
    assert.strictEqual(weights.semantic, 0.35);
  });

  it("normalizes weights to sum to 1", () => {
    const weights = normalizeWeights({
      semantic: 1,
      temporal: 1,
      graph: 1,
      entity: 1,
      keyword: 1,
    });
    const sum = weights.semantic + weights.temporal + weights.graph + weights.entity + weights.keyword;
    assert.ok(Math.abs(sum - 1) < 0.0001);
  });
});
