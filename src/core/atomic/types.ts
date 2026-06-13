/**
 * core/atomic/types.ts — Atomic fact types for structured memory extraction.
 */

export interface AtomicFact {
  id: string;
  subject: string;      // 主语（实体）
  predicate: string;    // 谓语（关系/动作）
  object: string;         // 宾语（目标/属性）
  confidence: number;   // 置信度 0-1
  source: string;       // 来源对话 ID
  timestamp: number;    // 提取时间
  tags: string[];       // 自动标签
}

export interface FactExtractionResult {
  facts: AtomicFact[];
  entities: string[];   // 提取的所有实体
  discarded: number;      // 丢弃的低质量片段数
}

export type ExtractionMode = "llm" | "regex" | "hybrid";
