/**
 * core/adaptive/weights.ts — Adaptive weight configuration and resolution.
 */
import { QueryType } from "./types.js";
const DEFAULT_WEIGHTS = {
    semantic: 0.35,
    temporal: 0.15,
    graph: 0.15,
    entity: 0.15,
    keyword: 0.20,
};
const TYPE_WEIGHTS = {
    [QueryType.CONCEPTUAL]: {
        semantic: 0.50, // 概念查询重视语义相似
        temporal: 0.10,
        graph: 0.15,
        entity: 0.10,
        keyword: 0.15,
    },
    [QueryType.TEMPORAL]: {
        semantic: 0.20,
        temporal: 0.45, // 时序查询重视时间衰减
        graph: 0.10,
        entity: 0.10,
        keyword: 0.15,
    },
    [QueryType.CAUSAL]: {
        semantic: 0.20,
        temporal: 0.10,
        graph: 0.45, // 因果查询重视图遍历
        entity: 0.10,
        keyword: 0.15,
    },
    [QueryType.ENTITY]: {
        semantic: 0.15,
        temporal: 0.10,
        graph: 0.10,
        entity: 0.45, // 实体查询重视实体匹配
        keyword: 0.20,
    },
    [QueryType.UNKNOWN]: DEFAULT_WEIGHTS,
};
export const DEFAULT_CONFIG = {
    defaultWeights: DEFAULT_WEIGHTS,
    typeWeights: TYPE_WEIGHTS,
    minConfidence: 0.3,
};
export function resolveWeights(classification, config = DEFAULT_CONFIG) {
    if (classification.confidence < config.minConfidence) {
        return config.defaultWeights;
    }
    return config.typeWeights[classification.type] ?? config.defaultWeights;
}
/** Normalize weights so they sum to 1.0 */
export function normalizeWeights(weights) {
    const sum = weights.semantic + weights.temporal + weights.graph + weights.entity + weights.keyword;
    if (sum === 0)
        return DEFAULT_WEIGHTS;
    return {
        semantic: weights.semantic / sum,
        temporal: weights.temporal / sum,
        graph: weights.graph / sum,
        entity: weights.entity / sum,
        keyword: weights.keyword / sum,
    };
}
