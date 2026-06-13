/**
 * core/adaptive/classify.ts — Query type classification engine.
 */

import { QueryType, type QueryClassification } from "./types.ts";

// Keyword triggers for each query type
const TRIGGERS: Record<string, string[]> = {
  conceptual: [
    "什么", "概念", "定义", "意思", "含义", "介绍", "解释",
    "what", "concept", "define", "meaning", "explain", "describe",
    "how does", "what is", "tell me about",
  ],
  temporal: [
    "什么时候", "时间", "日期", "之前", "之后", "最近", "上次", "下次",
    "when", "time", "date", "before", "after", "recent", "last", "next",
    "yesterday", "today", "tomorrow", "ago", "schedule",
  ],
  causal: [
    "为什么", "原因", "导致", "因为", "所以", "结果", "影响",
    "why", "cause", "reason", "because", "result", "effect", "impact",
    "how come", "what caused", "lead to", "due to",
  ],
  entity: [
    "谁", "哪里", "哪个", "名称", "叫", "关于",
    "who", "where", "which", "name", "called", "about",
    "find", "search for", "look up",
  ],
  unknown: [],
};

function countMatches(query: string, keywords: string[]): number {
  const lower = query.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) count++;
  }
  return count;
}

export function classifyQuery(query: string): QueryClassification {
  const scores: Record<string, number> = {
    conceptual: 0,
    temporal: 0,
    causal: 0,
    entity: 0,
    unknown: 0,
  };

  const matchedKeywords: Record<string, string[]> = {
    conceptual: [],
    temporal: [],
    causal: [],
    entity: [],
    unknown: [],
  };

  // Count matches for each type
  for (const [type, keywords] of Object.entries(TRIGGERS)) {
    if (type === QueryType.UNKNOWN) continue;
    const qType = type as QueryType;
    for (const kw of keywords) {
      if (query.toLowerCase().includes(kw.toLowerCase())) {
        scores[qType]++;
        matchedKeywords[qType].push(kw);
      }
    }
  }

  // Find best match
  let bestType: QueryType = QueryType.UNKNOWN;
  let bestScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as QueryType;
    }
  }

  // Calculate confidence (normalize by query length)
  const queryWords = query.split(/\s+/).length;
  const confidence = queryWords > 0
    ? Math.min(1, bestScore / Math.sqrt(queryWords))
    : 0;

  return {
    type: bestType,
    confidence,
    keywords: matchedKeywords[bestType],
  };
}
