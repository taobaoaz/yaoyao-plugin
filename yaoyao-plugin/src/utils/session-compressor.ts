/**
 * Session Compressor — 会话文本评分/压缩
 * 从 Brain (memory-lancedb-pro) 学习：优先高信号内容
 * 零外部依赖，纯本地
 */
import {
  TOOL_CALL_INDICATORS,
  CORRECTION_INDICATORS,
  DECISION_INDICATORS,
  ACKNOWLEDGMENT_PATTERNS,
  MEMORY_INTENT,
  MEMORY_INTENT_CJK,
} from "./compressor-indicators.ts";
import { compressTexts } from "./compressor-core.ts";

export interface ScoredText {
  index: number;
  text: string;
  score: number;
  reason: string;
}

export interface CompressResult {
  texts: string[];
  scored: ScoredText[];
  dropped: number;
  totalChars: number;
}

export { compressTexts };

export function scoreText(text: string, index: number): ScoredText {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { index, text, score: 0.0, reason: "empty" };
  }

  if (TOOL_CALL_INDICATORS.some((p) => p.test(trimmed))) {
    return { index, text, score: 1.0, reason: "tool_call" };
  }

  if (CORRECTION_INDICATORS.some((p) => p.test(trimmed))) {
    return { index, text, score: 0.95, reason: "correction" };
  }

  if (DECISION_INDICATORS.some((p) => p.test(trimmed))) {
    return { index, text, score: 0.85, reason: "decision" };
  }

  if (ACKNOWLEDGMENT_PATTERNS.some((p) => p.test(trimmed))) {
    return { index, text, score: 0.1, reason: "acknowledgment" };
  }

  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(trimmed);
  const substantiveMinLength = hasCJK ? 30 : 80;
  if (trimmed.length > substantiveMinLength) {
    if (/^<[a-z-]+>/.test(trimmed) && /<\/[a-z-]+>\s*$/.test(trimmed)) {
      return { index, text, score: 0.3, reason: "system_xml" };
    }
    return { index, text, score: 0.7, reason: "substantive" };
  }

  if (trimmed.includes("?") || trimmed.includes("？")) {
    return { index, text, score: 0.5, reason: "short_question" };
  }

  return { index, text, score: 0.4, reason: "short_statement" };
}

export function estimateConversationValue(texts: string[]): number {
  if (texts.length === 0) return 0;
  let value = 0;
  const joined = texts.join(" ");

  if (MEMORY_INTENT.test(joined) || MEMORY_INTENT_CJK.test(joined)) {
    value += 0.5;
  }

  if (TOOL_CALL_INDICATORS.some((p) => p.test(joined))) {
    value += 0.4;
  }

  const hasCorrectionOrDecision =
    CORRECTION_INDICATORS.some((p) => p.test(joined)) ||
    DECISION_INDICATORS.some((p) => p.test(joined));
  if (hasCorrectionOrDecision) {
    value += 0.3;
  }

  const substantiveChars = texts
    .filter((t) => t.trim().length > 20)
    .reduce((sum, t) => sum + t.length, 0);
  if (substantiveChars > 200) {
    value += 0.2;
  }

  if (texts.length > 6) {
    value += 0.1;
  }

  return Math.min(value, 1.0);
}
