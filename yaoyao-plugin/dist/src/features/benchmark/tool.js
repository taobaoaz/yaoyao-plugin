/**
 * features/benchmark/tool.ts — Memory benchmark runner tool.
 */
import { runBenchmark, formatReport } from "../../core/benchmark/runner.js";
export function createBenchmarkTool() {
    return {
        name: "memory_benchmark",
        description: "Run memory system benchmark tests to evaluate recall quality.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["run", "list_cases"],
                    description: "Action to perform",
                },
                maxCases: {
                    type: "number",
                    description: "Max test cases to run",
                    default: 8,
                },
                searchFn: {
                    type: "string",
                    description: "Optional: custom search function name (not implemented yet)",
                },
            },
            required: ["action"],
        },
        handler: async (args) => {
            const action = args.action;
            if (action === "list_cases") {
                const suite = (await import("../../core/benchmark/cases.js")).getBenchmarkSuite();
                return {
                    suiteName: suite.name,
                    version: suite.metadata.version,
                    totalCases: suite.metadata.totalCases,
                    categories: [...new Set(suite.cases.map((c) => c.category))],
                    difficulties: [...new Set(suite.cases.map((c) => c.difficulty))],
                    cases: suite.cases.map((c) => ({
                        id: c.id,
                        name: c.name,
                        category: c.category,
                        difficulty: c.difficulty,
                        question: c.question,
                    })),
                };
            }
            if (action === "run") {
                const maxCases = args.maxCases ?? 8;
                const report = await runBenchmark({ maxCases });
                const markdown = formatReport(report);
                return {
                    summary: {
                        totalCases: report.totalCases,
                        passedCases: report.passedCases,
                        failedCases: report.failedCases,
                        avgScore: report.avgScore,
                        avgLatencyMs: report.avgLatencyMs,
                    },
                    byCategory: report.byCategory,
                    byDifficulty: report.byDifficulty,
                    markdown,
                };
            }
            return { error: "Unknown action" };
        },
    };
}
