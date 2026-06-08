/**
 * core/search/intent.ts — Query intent classification.
 *
 * Analyzes a search query to determine what kind of information
 * the user is looking for, enabling intent-aware search strategies.
 *
 * Ported from Cortex Memory's QueryIntentType + weight_model concepts.
 */

/** Types of query intent — controls which memory layer(s) to favour */
export type QueryIntent =
  /** Named entity: person, place, tool, concept */
  | 'entity_lookup'
  /** Factual: what is X, when did Y happen */
  | 'factual'
  /** Temporal: involves time references (today, last week, June) */
  | 'temporal'
  /** Relational: compare/connect multiple concepts */
  | 'relational'
  /** Broad search: find/list/anything about X */
  | 'exploratory'
  /** General / unknown */
  | 'general';

/** Weight profile for three retrieval signals */
export interface IntentWeights {
  /** FTS5 full-text weight (keyword match) */
  fts: number;
  /** Vector similarity weight (semantic match) */
  vector: number;
  /** Temporal decay weight (recency) */
  temporal: number;
}

// ── Intent classifiers ──

/** Time-related patterns (Chinese + English) */
const TEMPORAL_PATTERNS = [
  /今天|昨天|前天|明天|后天|上周|这周|本周|下周|上个月|这个月|下个月|去年|今年|明年|\d+月\d+日|\d+月|\d+号|星期[一二三四五六日天]|周[一二三四五六日天]|最近|近期|以前|之前|刚才|刚刚|早上|下午|晚上|昨晚/i,
  /today|yesterday|tomorrow|last\s+(week|month|year)|this\s+(week|month|year)|next\s+(week|month|year)|recent|lately|ago|earlier/i,
  /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/,
];

/** Named entity patterns */
const ENTITY_PATTERNS = [
  /^who|^什么人|^哪个.*(?:人|公司|组织|团队|产品|工具)|找.*(?:人|公司|组织)/i,
  /^what.*(?:is|are|叫|是|有)/i,
];

/** Comparative / relational patterns */
const RELATIONAL_PATTERNS = [
  /和.*(?:区别|对比|比较|关系|相同|不同|哪个好|谁好)/i,
  /difference|compare|vs|versus|relation(ship)?|similar|better.*than|vs\./i,
  /(?:A|B)和(?:B|A)/i,
];

/** Broad exploration patterns */
const EXPLORATORY_PATTERNS = [
  /^(?:关于|有关|有没有|帮我找|搜索|查一下|看看|有什么|哪些|列举|列出|总结|概述|汇总|回顾)/i,
  /^(?:about|find|search|list|show|tell|look\s+up|any|summarize|overview)/i,
];

// ── Intent weight profiles ──

/**
 * Dynamic weight profiles per intent type.
 * Entity lookups favour vector (semantic), temporal favours recency,
 * relational favours FTS (keyword overlap), exploratory stays balanced.
 */
export const INTENT_WEIGHTS: Record<QueryIntent, IntentWeights> = {
  entity_lookup: { fts: 0.25, vector: 0.65, temporal: 0.1 },
  factual: { fts: 0.35, vector: 0.5, temporal: 0.15 },
  temporal: { fts: 0.25, vector: 0.25, temporal: 0.5 },
  relational: { fts: 0.55, vector: 0.35, temporal: 0.1 },
  exploratory: { fts: 0.4, vector: 0.35, temporal: 0.25 },
  general: { fts: 0.33, vector: 0.34, temporal: 0.33 },
};

// ── Public API ──

/**
 * Classify a search query into an intent type.
 * Uses pattern matching (no LLM call needed for this).
 */
export function classifyIntent(query: string): QueryIntent {
  if (typeof query !== 'string' || query.length === 0) return 'general';

  // Relational check first (most specific patterns)
  for (const p of RELATIONAL_PATTERNS) {
    if (p.test(query)) return 'relational';
  }

  // Entity lookup
  for (const p of ENTITY_PATTERNS) {
    if (p.test(query)) return 'entity_lookup';
  }

  // Temporal
  for (const p of TEMPORAL_PATTERNS) {
    if (p.test(query)) return 'temporal';
  }

  // Exploratory
  for (const p of EXPLORATORY_PATTERNS) {
    if (p.test(query)) return 'exploratory';
  }

  return 'general';
}

/**
 * Get the weight profile for a query intent.
 * Falls back to general weights for unknown intents.
 */
export function weightsForIntent(intent: QueryIntent): IntentWeights {
  return INTENT_WEIGHTS[intent] ?? INTENT_WEIGHTS.general;
}

/**
 * Get weights by directly classifying a query string.
 * Convenience wrapper for classifyIntent + weightsForIntent.
 */
export function intentWeightsForQuery(query: string): IntentWeights {
  return weightsForIntent(classifyIntent(query));
}
