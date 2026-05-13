/**
 * Tests for core/verify.ts — anti-hallucination detection engine.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectSpeculative,
  detectCorrection,
  scoreEvidence,
} from "../core/verify/verify.ts";

describe("detectSpeculative", () => {
  it("detects Chinese speculative markers", () => {
    const result = detectSpeculative("我觉得你可能不太确定这件事");
    assert.strictEqual(result.isSpeculative, true);
    assert.ok(result.markers.includes("我觉得"));
    assert.ok(result.markers.includes("可能"));
  });

  it("detects English speculative markers", () => {
    const result = detectSpeculative("I think maybe we should probably do this");
    assert.strictEqual(result.isSpeculative, true);
    assert.ok(result.markers.includes("I think"));
    assert.ok(result.markers.includes("maybe"));
  });

  it("returns high confidence for non-speculative text", () => {
    const result = detectSpeculative("今天的天气很好，我们去公园。");
    assert.strictEqual(result.isSpeculative, false);
    assert.strictEqual(result.confidence, "high");
    assert.strictEqual(result.markers.length, 0);
  });

  it("returns low confidence for many markers", () => {
    const result = detectSpeculative("我觉得你可能也许大概应该这样做");
    assert.strictEqual(result.isSpeculative, true);
    assert.strictEqual(result.confidence, "low");
  });
});

describe("detectCorrection", () => {
  it("detects Chinese correction markers", () => {
    const result = detectCorrection("不对，我不是这么说的");
    assert.strictEqual(result.isCorrection, true);
    assert.ok(result.markers.includes("不对"));
  });

  it("detects English correction markers", () => {
    const result = detectCorrection("No, that's not right. You're wrong.");
    assert.strictEqual(result.isCorrection, true);
    assert.ok(result.markers.includes("no"));
    assert.ok(result.markers.includes("wrong"));
  });

  it("returns false for normal text", () => {
    const result = detectCorrection("好的，我明白了。");
    assert.strictEqual(result.isCorrection, false);
  });
});

describe("scoreEvidence", () => {
  it("returns unconfirmed for empty results", () => {
    const result = scoreEvidence("用户喜欢猫", []);
    assert.strictEqual(result.verdict, "unconfirmed");
    assert.strictEqual(result.confidence, 0);
  });

  it("returns confirmed for high overlap", () => {
    const snippets = [
      { snippet: "用户提到自己养了两只猫，一只橘猫一只白猫", filename: "2026-05-10.md" },
    ];
    const result = scoreEvidence("用户养猫", snippets);
    assert.strictEqual(result.verdict, "confirmed");
    assert.ok(result.confidence > 0.7);
  });

  it("returns partial for medium overlap", () => {
    const snippets = [
      { snippet: "用户提到喜欢小动物", filename: "2026-05-10.md" },
    ];
    const result = scoreEvidence("用户养猫", snippets);
    assert.strictEqual(result.verdict, "partial");
  });

  it("detects contradiction on negation mismatch", () => {
    const snippets = [
      { snippet: "用户明确表示不喜欢猫", filename: "2026-05-10.md" },
    ];
    const result = scoreEvidence("用户喜欢猫", snippets);
    assert.strictEqual(result.verdict, "contradicted");
  });

  it("limits evidence to top 3", () => {
    const snippets = Array.from({ length: 10 }, (_, i) => ({
      snippet: `记忆片段 ${i}`,
      filename: `2026-05-${10 + i}.md`,
    }));
    const result = scoreEvidence("测试", snippets);
    assert.strictEqual(result.evidence.length, 3);
  });
});
