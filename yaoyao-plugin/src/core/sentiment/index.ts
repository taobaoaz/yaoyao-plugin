/**
 * core/sentiment/index.ts — BARREL (re-exports for backward compat)
 *
 * Split into:
 *   types.ts       → SentimentResult, EmotionLabel
 *   lexicon.ts     → cn/en lexicons + emoji markers
 *   analysis.ts    → detectSentiment, summarizeMood
 */
export type { SentimentResult, EmotionLabel } from "./types.ts";
export { detectSentiment, summarizeMood } from "./analysis.ts";
