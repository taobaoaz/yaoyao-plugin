/**
 * core/value/memory-value.ts — Multi-factor memory value function.
 *
 * Paper: "Learning What to Remember" (arXiv:2606.12945) — V(m) = Σ wᵢfᵢ(m)
 * over seven interpretable factors from cognitive psychology.
 *
 * This replaces the single scalar `importance` with a richer value model.
 * The learned weights prioritize reliability, emotional intensity, and
 * self/user relevance (per paper findings on LongMemEval).
 *
 * All factors are rule-based (no LLM call) and produce a [0,1] scalar.
 */

import { detectSentiment } from "../sentiment/analysis.ts";

export interface MemoryValueFactors {
  /** Emotional intensity: how much affective charge the content carries (0-1) */
  emotionalIntensity: number;
  /** Goal relevance: alignment with stated user goals/intentions (0-1) */
  goalRelevance: number;
  /** Value alignment: alignment with user preferences and identity (0-1) */
  valueAlignment: number;
  /** Self/user relevance: mentions of user identity, personal context (0-1) */
  userRelevance: number;
  /** Task utility: actionable information for common tasks (0-1) */
  taskUtility: number;
  /** Reliability: confidence in the accuracy of the content (0-1) */
  reliability: number;
  /** Usage history: how often this memory has been accessed (0-1) */
  usageHistory: number;
}

export interface MemoryValueWeights {
  emotionalIntensity: number;
  goalRelevance: number;
  valueAlignment: number;
  userRelevance: number;
  taskUtility: number;
  reliability: number;
  usageHistory: number;
}

/** Default weights learned from LongMemEval (paper Table 3 approximation).
 *  Reliability and user relevance dominate; query-time goal similarity is
 *  down-weighted for the forgetting decision. */
export const DEFAULT_VALUE_WEIGHTS: MemoryValueWeights = {
  emotionalIntensity: 0.18,
  goalRelevance: 0.12,
  valueAlignment: 0.10,
  userRelevance: 0.20,
  taskUtility: 0.10,
  reliability: 0.20,
  usageHistory: 0.10,
};

const GOAL_MARKERS = [
  /计划|打算|准备|想要|希望|目标|梦想|决定|需要|必须|应该/i,
  /plan|intend|goal|aim|target|hope|wish|want|need|must|should/i,
];

const PREFERENCE_MARKERS = [
  /喜欢|不喜欢|偏爱|习惯|推荐|最好|最适合/i,
  /prefer|like|love|hate|habit|recommend|best/i,
];

const TASK_MARKERS = [
  /怎么|如何|怎样|步骤|方法|教程|指南|操作/i,
  /how\s+to|steps?|method|tutorial|guide|procedure|workflow/i,
];

const IDENTITY_MARKERS = [
  /我叫|我是|我的|我自己|本人/i,
  /my\s+name|i\s+am|i'm|myself|personally/i,
];

/**
 * Compute the seven factors for a memory.
 * All inputs are the raw text content plus optional metadata from prior captures.
 */
export function computeValueFactors(
  userText: string,
  asstText: string,
  meta?: {
    speculative?: boolean;
    correction?: boolean;
    accessCount?: number;
    memoryType?: string;
  },
): MemoryValueFactors {
  const combined = `${userText} ${asstText}`;

  // 1. Emotional intensity — from sentiment analysis
  const sentiment = detectSentiment(combined);
  const totalEmotion = Object.values(sentiment.emotions).reduce((a, b) => a + b, 0);
  const emotionalIntensity = Math.min(1, totalEmotion / 8);

  // 2. Goal relevance — presence of goal/intention markers
  const goalRelevance = GOAL_MARKERS.some(p => p.test(combined)) ? 0.8 : 0.2;

  // 3. Value alignment — preference markers + memory type
  const hasPref = PREFERENCE_MARKERS.some(p => p.test(combined));
  const valueAlignment = hasPref ? 0.85 : (meta?.memoryType === "preference" ? 0.7 : 0.3);

  // 4. Self/user relevance — identity markers + identity addressing
  const hasIdentity = IDENTITY_MARKERS.some(p => p.test(combined));
  const userRelevance = hasIdentity ? 0.9 : (meta?.memoryType === "entity" ? 0.7 : 0.3);

  // 5. Task utility — actionable/how-to content
  const taskUtility = TASK_MARKERS.some(p => p.test(combined)) ? 0.8 : 0.3;

  // 6. Reliability — inverse of speculative/correction
  let reliability = 0.9;
  if (meta?.speculative) reliability *= 0.6;
  if (meta?.correction) reliability *= 0.5;

  // 7. Usage history — log-scaled access count
  const accessCount = meta?.accessCount ?? 0;
  const usageHistory = accessCount > 0
    ? Math.min(1, 0.2 + Math.log(1 + accessCount) * 0.2)
    : 0.1;

  return {
    emotionalIntensity,
    goalRelevance,
    valueAlignment,
    userRelevance,
    taskUtility,
    reliability,
    usageHistory,
  };
}

/**
 * Compute the aggregate memory value V(m) = Σ wᵢfᵢ(m).
 * Returns a scalar in [0,1] that controls encoding depth, forget risk,
 * and retrieval rank.
 */
export function computeMemoryValue(
  factors: MemoryValueFactors,
  weights: MemoryValueWeights = DEFAULT_VALUE_WEIGHTS,
): number {
  return (
    weights.emotionalIntensity * factors.emotionalIntensity +
    weights.goalRelevance * factors.goalRelevance +
    weights.valueAlignment * factors.valueAlignment +
    weights.userRelevance * factors.userRelevance +
    weights.taskUtility * factors.taskUtility +
    weights.reliability * factors.reliability +
    weights.usageHistory * factors.usageHistory
  );
}