import { describe, it } from "node:test";
import assert from "node:assert";
import {
  jaccardSnippet,
  findDuplicates,
  computeDateStats,
  generateRecommendations,
  formatQualityReport,
  formatDedupReport,
} from "../core/quality/quality.ts";

describe("jaccardSnippet", () => {
  it("returns 1 for identical strings", () => {
    assert.strictEqual(jaccardSnippet("hello world", "hello world"), 1);
  });

  it("returns 0 for completely different strings", () => {
    assert.strictEqual(jaccardSnippet("abc", "xyz"), 0);
  });

  it("returns between 0 and 1 for partial overlap", () => {
    const score = jaccardSnippet("hello world", "hello there");
    assert.ok(score > 0 && score < 1);
  });

  it("returns 0 when either string is empty", () => {
    assert.strictEqual(jaccardSnippet("", "abc"), 0);
    assert.strictEqual(jaccardSnippet("abc", ""), 0);
  });
});

describe("findDuplicates", () => {
  it("finds near-duplicate pairs", () => {
    const docs = [
      { filename: "a.md", snippet: "hello world foo bar" },
      { filename: "b.md", snippet: "hello world foo baz" },
      { filename: "c.md", snippet: "completely different" },
    ];
    const dups = findDuplicates(docs, 0.5);
    assert.strictEqual(dups.length, 1);
    assert.strictEqual(dups[0].a.filename, "a.md");
    assert.strictEqual(dups[0].b.filename, "b.md");
    assert.ok(dups[0].similarity >= 0.5);
  });

  it("returns empty for no duplicates", () => {
    const docs = [
      { filename: "a.md", snippet: "aaa bbb ccc" },
      { filename: "b.md", snippet: "xxx yyy zzz" },
    ];
    const dups = findDuplicates(docs, 0.5);
    assert.deepStrictEqual(dups, []);
  });
});

describe("computeDateStats", () => {
  it("computes date stats from daily files", () => {
    const files = [
      { filename: "2026-05-14.md" },
      { filename: "2026-05-13.md" },
      { filename: "2026-05-11.md" },
    ];
    const stats = computeDateStats(files, 30);
    assert.strictEqual(stats.totalDays, 4);
    assert.strictEqual(stats.dateCoverage, 75.0);
    assert.strictEqual(stats.avgPerDay, 10);
  });
});

describe("generateRecommendations", () => {
  it("generates suggestions for low coverage", () => {
    const recs = generateRecommendations(30, 14, 10, 1000, 2000, 0, 7);
    assert.ok(recs.length > 0);
    assert.ok(recs.some(r => r.includes("覆盖率")));
  });

  it("generates suggestions for high duplication", () => {
    const recs = generateRecommendations(80, 30, 25, 100, 1000, 3, 30);
    assert.ok(recs.some(r => r.includes("重复")));
  });
});

describe("formatQualityReport", () => {
  it("formats report with sections", () => {
    const stats = { totalDays: 7, dateCoverage: 50, avgPerDay: 5, recent7Count: 2, recent30Count: 5 };
    const report = formatQualityReport(10, 5, 50, 500, 200, stats, 15, ["建议A"]);
    assert.ok(report.includes("10"));
    assert.ok(report.includes("建议A"));
    assert.ok(report.includes("记忆质量评估"));
  });
});

describe("formatDedupReport", () => {
  it("formats dedup report", () => {
    const dups = [
      { a: { filename: "a.md", snippet: "hello" }, b: { filename: "b.md", snippet: "hello" }, similarity: 0.95 },
    ];
    const report = formatDedupReport(dups);
    assert.ok(report.includes("a.md"));
    assert.ok(report.includes("b.md"));
    assert.ok(report.includes("0.95"));
  });

  it("returns empty message for no duplicates", () => {
    const report = formatDedupReport([]);
    assert.ok(report.includes("未发现重复"));
  });
});
