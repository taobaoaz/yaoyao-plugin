/**
 * core/benchmark/runner.ts — Benchmark execution engine.
 */

import type { BenchmarkCase, BenchmarkResult, BenchmarkReport } from "./types.ts";
import { getBenchmarkSuite } from "./cases.ts";

function evaluateAnswer(response: string, expected: string): { passed: boolean; score: number } {
  const lowerResponse = response.toLowerCase();
  const lowerExpected = expected.toLowerCase();

  // Exact match
  if (lowerResponse.includes(lowerExpected)) {
    return { passed: true, score: 1.0 };
  }

  // Partial match (word overlap)
  const expectedWords = lowerExpected.split(/\s+/);
  const matchedWords = expectedWords.filter((w) => lowerResponse.includes(w));
  const score = matchedWords.length / expectedWords.length;

  return { passed: score >= 0.5, score };
}

export async function runBenchmark(
  options?: {
    searchFn?: (query: string) => Promise<string[]>;
    answerFn?: (question: string, context: string[]) => Promise<string>;
    maxCases?: number;
  },
): Promise<BenchmarkReport> {
  const suite = getBenchmarkSuite();
  const cases = options?.maxCases
    ? suite.cases.slice(0, options.maxCases)
    : suite.cases;

  const results: BenchmarkResult[] = [];

  for (const testCase of cases) {
    const startTime = Date.now();

    // Simulate memory search
    let retrievedMemories: string[] = [];
    if (options?.searchFn) {
      retrievedMemories = await options.searchFn(testCase.question);
    } else {
      // Fallback: simple keyword matching from conversation
      retrievedMemories = testCase.conversation.filter((line) =>
        testCase.expectedAnswer.split(/\s+/).some((word) =>
          line.toLowerCase().includes(word.toLowerCase())
        )
      );
    }

    // Simulate answering
    let response = "";
    if (options?.answerFn) {
      response = await options.answerFn(testCase.question, retrievedMemories);
    } else {
      // Fallback: return first matching memory
      response = retrievedMemories[0] ?? "I don't know.";
    }

    const latencyMs = Date.now() - startTime;
    const evaluation = evaluateAnswer(response, testCase.expectedAnswer);

    results.push({
      caseId: testCase.id,
      passed: evaluation.passed,
      score: evaluation.score,
      retrievedMemories,
      response,
      latencyMs,
    });
  }

  // Generate report
  const passedCases = results.filter((r) => r.passed).length;
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);

  const byCategory: Record<string, { passed: number; total: number; avgScore: number }> = {};
  const byDifficulty: Record<string, { passed: number; total: number; avgScore: number }> = {};

  for (const testCase of cases) {
    const result = results.find((r) => r.caseId === testCase.id)!;
    const cat = testCase.category;
    const diff = testCase.difficulty;

    if (!byCategory[cat]) byCategory[cat] = { passed: 0, total: 0, avgScore: 0 };
    byCategory[cat].total++;
    if (result.passed) byCategory[cat].passed++;
    byCategory[cat].avgScore += result.score;

    if (!byDifficulty[diff]) byDifficulty[diff] = { passed: 0, total: 0, avgScore: 0 };
    byDifficulty[diff].total++;
    if (result.passed) byDifficulty[diff].passed++;
    byDifficulty[diff].avgScore += result.score;
  }

  // Normalize averages
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].avgScore /= byCategory[cat].total;
  }
  for (const diff of Object.keys(byDifficulty)) {
    byDifficulty[diff].avgScore /= byDifficulty[diff].total;
  }

  return {
    suiteName: suite.name,
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    avgScore: totalScore / cases.length,
    avgLatencyMs: totalLatency / cases.length,
    byCategory,
    byDifficulty,
    timestamp: Date.now(),
  };
}

export function formatReport(report: BenchmarkReport): string {
  const lines = [
    `# 📊 Benchmark Report: ${report.suiteName}`,
    "",
    `**Total Cases**: ${report.totalCases}`,
    `**Passed**: ${report.passedCases} ✅`,
    `**Failed**: ${report.failedCases} ❌`,
    `**Average Score**: ${(report.avgScore * 100).toFixed(1)}%`,
    `**Average Latency**: ${report.avgLatencyMs.toFixed(0)}ms`,
    "",
    "## By Category",
    "",
  ];

  for (const [cat, stats] of Object.entries(report.byCategory)) {
    lines.push(`### ${cat}`);
    lines.push(`- Passed: ${stats.passed}/${stats.total}`);
    lines.push(`- Avg Score: ${(stats.avgScore * 100).toFixed(1)}%`);
    lines.push("");
  }

  lines.push("## By Difficulty");
  lines.push("");

  for (const [diff, stats] of Object.entries(report.byDifficulty)) {
    lines.push(`### ${diff}`);
    lines.push(`- Passed: ${stats.passed}/${stats.total}`);
    lines.push(`- Avg Score: ${(stats.avgScore * 100).toFixed(1)}%`);
    lines.push("");
  }

  return lines.join("\n");
}
