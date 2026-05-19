/**
 * core/benchmark/types.ts — Benchmark types for memory evaluation.
 */

export interface BenchmarkCase {
  id: string;
  name: string;
  description: string;
  category: "single-hop" | "multi-hop" | "temporal" | "open-domain";
  conversation: string[];      // 模拟对话历史
  question: string;          // 测试问题
  expectedAnswer: string;      // 期望答案（关键词或模式）
  difficulty: "easy" | "medium" | "hard";
}

export interface BenchmarkResult {
  caseId: string;
  passed: boolean;
  score: number;              // 0-1 匹配度
  retrievedMemories: string[]; // 检索到的记忆
  response: string;           // AI 回答
  latencyMs: number;          // 响应时间
}

export interface BenchmarkSuite {
  name: string;
  cases: BenchmarkCase[];
  metadata: {
    version: string;
    createdAt: number;
    totalCases: number;
  };
}

export interface BenchmarkReport {
  suiteName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  avgScore: number;
  avgLatencyMs: number;
  byCategory: Record<string, { passed: number; total: number; avgScore: number }>;
  byDifficulty: Record<string, { passed: number; total: number; avgScore: number }>;
  timestamp: number;
}
