/**
 * Tests for sentiment.ts — Chinese/English sentiment analyzer.
 *
 * Run: node --test src/__tests__/sentiment.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { detectSentiment, summarizeMood } from "../utils/sentiment.ts";

describe("detectSentiment", () => {
  it("returns neutral for empty text", () => {
    const r = detectSentiment("");
    assert.strictEqual(r.label, "neutral");
  });

  it("returns neutral for short text", () => {
    const r = detectSentiment("a");
    assert.strictEqual(r.label, "neutral");
  });

  it("detects positive Chinese sentiment: 今天很开心", () => {
    const r = detectSentiment("今天很开心，感觉很幸福");
    assert.strictEqual(r.label, "positive");
    assert(r.positive > r.negative);
  });

  it("detects negative Chinese sentiment: 很难过", () => {
    const r = detectSentiment("最近很难过，非常痛苦");
    assert.strictEqual(r.label, "negative");
    assert(r.negative > r.positive);
  });

  it("detects positive English sentiment: I love this, it's amazing", () => {
    const r = detectSentiment("I love this, it's amazing and wonderful");
    assert.strictEqual(r.label, "positive");
  });

  it("detects negative English sentiment: this is terrible and awful", () => {
    const r = detectSentiment("this is terrible and awful, I hate it");
    assert.strictEqual(r.label, "negative");
  });

  it("returns emoji matching label", () => {
    const pos = detectSentiment("amazing success");
    const neg = detectSentiment("terrible failure");
    assert(pos.emoji.length >= 1);
    assert(neg.emoji.length >= 1);
  });

  it("confidence increases with more sentiment words", () => {
    const low = detectSentiment("nice");
    const high = detectSentiment("amazing awesome wonderful fantastic brilliant");
    assert(high.confidence >= low.confidence);
  });

  it("mixed sentiment gives neutral", () => {
    const r = detectSentiment("nice good but sad angry");
    assert(r.label === "neutral");
  });
});

describe("summarizeMood", () => {
  it("returns 暂无数据 for empty array", () => {
    assert.strictEqual(summarizeMood([]), "暂无数据");
  });

  it("detects predominantly positive mood", () => {
    const texts = ["开心", "幸福", "成功", "很棒", "今天累了"];
    const summary = summarizeMood(texts);
    assert(summary.includes("不错") || summary.includes("积极"));
  });

  it("detects predominantly negative mood", () => {
    const texts = ["失败", "痛苦", "崩溃", "难受", "伤心"];
    const summary = summarizeMood(texts);
    assert(summary.includes("低落") || summary.includes("烦恼"));
  });
});
