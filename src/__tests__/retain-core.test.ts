import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectAtRisk,
  formatRetainCheck,
  formatBoostResult,
  formatImportantResult,
} from "../core/retain/retain.ts";

describe("detectAtRisk", () => {
  it("returns empty when all memories are recent", () => {
    const memories = [
      { keyword: "a", filename: "2026-05-14.md", snippet: "hello" },
      { keyword: "b", filename: "2026-05-13.md", snippet: "world" },
    ];
    const boosts = [
      { keyword: "a", filename: "2026-05-14.md", boostedAt: new Date().toISOString() },
      { keyword: "b", filename: "2026-05-13.md", boostedAt: new Date().toISOString() },
    ];
    const atRisk = detectAtRisk(memories, boosts, [], 7);
    assert.deepStrictEqual(atRisk, []);
  });

  it("flags old memories", () => {
    const memories = [
      { keyword: "old", filename: "2026-04-01.md", snippet: "ancient" },
    ];
    const boosts = [
      { keyword: "old", boostedAt: "2026-04-01T00:00:00Z" },
    ];
    const atRisk = detectAtRisk(memories, boosts, [], 7);
    assert.strictEqual(atRisk.length, 1);
    assert.strictEqual(atRisk[0].keyword, "old");
    assert.ok(atRisk[0].daysSinceRecall > 7);
  });

  it("flags important memories even if never recalled", () => {
    const memories = [
      { keyword: "important", filename: "x.md", snippet: "valuable" },
    ];
    const atRisk = detectAtRisk(memories, [], [{ keyword: "important", taggedAt: "2026-05-01" }], 7);
    assert.strictEqual(atRisk.length, 1);
    assert.strictEqual(atRisk[0].daysSinceRecall, 9999);
    assert.strictEqual(atRisk[0].isImportant, true);
  });

  it("sorts important first then by days", () => {
    const memories = [
      { keyword: "a", filename: "a.md", snippet: "aa" },
      { keyword: "b", filename: "b.md", snippet: "bb" },
    ];
    const boosts = [
      { keyword: "a", boostedAt: "2026-04-01T00:00:00Z" },
      { keyword: "b", boostedAt: "2026-03-01T00:00:00Z" },
    ];
    const important = [{ keyword: "b", taggedAt: "2026-05-01" }];
    const atRisk = detectAtRisk(memories, boosts, important, 7);
    assert.strictEqual(atRisk[0].keyword, "b"); // important first
    assert.strictEqual(atRisk[1].keyword, "a");
  });
});

describe("formatRetainCheck", () => {
  it("formats healthy state", () => {
    const text = formatRetainCheck(10, 5, 2, []);
    assert.ok(text.includes("没有发现遗忘风险"));
    assert.ok(text.includes("10"));
  });

  it("formats at-risk list", () => {
    const atRisk = [
      { keyword: "k", filename: "f.md", snippet: "s", lastRecalled: "2026-04-01", daysSinceRecall: 30, isImportant: true },
    ];
    const text = formatRetainCheck(10, 0, 1, atRisk);
    assert.ok(text.includes("遗忘风险"));
    assert.ok(text.includes("⭐"));
    assert.ok(text.includes("30 天"));
  });
});

describe("formatBoostResult", () => {
  it("formats boost success", () => {
    const text = formatBoostResult("test", "f.md", "important", "2026-05-14", 3);
    assert.ok(text.includes("test"));
    assert.ok(text.includes("f.md"));
    assert.ok(text.includes("3 条"));
  });
});

describe("formatImportantResult", () => {
  it("formats important tag success", () => {
    const text = formatImportantResult("test", undefined, "reason", "2026-05-14");
    assert.ok(text.includes("⭐"));
    assert.ok(text.includes("test"));
    assert.ok(text.includes("reason"));
  });
});
