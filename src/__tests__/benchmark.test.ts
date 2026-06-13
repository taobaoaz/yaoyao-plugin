import { describe, it } from "node:test";
import assert from "node:assert";
import { getBenchmarkSuite } from "../core/benchmark/cases.ts";
import { runBenchmark, formatReport } from "../core/benchmark/runner.ts";

describe("benchmark suite", () => {
  it("contains test cases", () => {
    const suite = getBenchmarkSuite();
    assert.ok(suite.cases.length > 0);
    assert.ok(suite.metadata.version);
  });

  it("has diverse categories", () => {
    const suite = getBenchmarkSuite();
    const categories = new Set(suite.cases.map((c) => c.category));
    assert.ok(categories.size > 1);
  });

  it("has multiple difficulties", () => {
    const suite = getBenchmarkSuite();
    const difficulties = new Set(suite.cases.map((c) => c.difficulty));
    assert.ok(difficulties.size > 1);
  });
});

describe("benchmark runner", () => {
  it("runs benchmark and produces report", async () => {
    const report = await runBenchmark({ maxCases: 2 });
    assert.strictEqual(report.totalCases, 2);
    assert.ok(report.avgScore >= 0);
    assert.ok(report.avgLatencyMs >= 0);
    assert.ok(report.byCategory);
    assert.ok(report.byDifficulty);
  });

  it("formats report as markdown", async () => {
    const report = await runBenchmark({ maxCases: 1 });
    const markdown = formatReport(report);
    assert.ok(markdown.includes("Benchmark Report"));
    assert.ok(markdown.includes("Total Cases"));
  });
});
