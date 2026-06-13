/**
 * core/adaptive/types.ts — Query classification and adaptive search types.
 */

export type QueryType = "conceptual" | "temporal" | "causal" | "entity" | "unknown";

export const QueryType = {
  CONCEPTUAL: "conceptual" as const,
  TEMPORAL: "temporal" as const,
  CAUSAL: "causal" as const,
  ENTITY: "entity" as const,
  UNKNOWN: "unknown" as const,
};

export interface QueryClassification {
  type: QueryType;
  confidence: number;        // 分类置信度 0-1
  keywords: string[];          // 触发分类的关键词
}

export interface SearchWeights {
  semantic: number;          // 向量/语义相似度权重
  temporal: number;          // 时间衰减权重
  graph: number;             // 图遍历权重
  entity: number;            // 实体匹配权重
  keyword: number;           // 关键词/FTS5 权重
}

export interface AdaptiveSearchConfig {
  defaultWeights: SearchWeights;
  typeWeights: Record<QueryType, SearchWeights>;
  minConfidence: number;     // 最低分类置信度，低于此用默认权重
}
