/**
 * Session Compressor — 会话文本评分/压缩
 * 从 Brain (memory-lancedb-pro) 学习：优先高信号内容
 * 零外部依赖，纯本地
 */

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

const TOOL_CALL_INDICATORS = [
  /\btool_use\b/i,
  /\btool_result\b/i,
  /\bfunction_call\b/i,
  /\b(memory_store|memory_recall|memory_forget|memory_update)\b/i,
];

const CORRECTION_INDICATORS = [
  /^no[,\.\s]/i,
  /\bactually\b/i,
  /\binstead\b/i,
  /\bwrong\b/i,
  /\bcorrect(ion)?\b/i,
  /\bfix\b/i,
  /不对/,
  /应该是/,
  /错了/,
  /改成/,
  /不是.*而是/,
];

const DECISION_INDICATORS = [
  /\blet'?s go with\b/i,
  /\bconfirmed?\b/i,
  /\bapproved?\b/i,
  /\bdecided?\b/i,
  /\bwe'?ll use\b/i,
  /\bgoing forward\b/i,
  /\bfrom now on\b/i,
  /\bagreed\b/i,
  /决定/,
  /确认/,
  /选择了/,
  /就这样/,
];

const ACKNOWLEDGMENT_PATTERNS = [
  /^(ok|okay|k|sure|fine|thanks|thank you|thx|ty|got it|understood|cool|nice|great|good|perfect|awesome|alright|yep|yup|yeah|right)\s*[.!]?$/i,
  /^好的?\s*[。！]?$/,
  /^嗯\s*[。]?$/,
  /^收到\s*[。！]?$/,
  /^了解\s*[。！]?$/,
  /^明白\s*[。！]?$/,
  /^谢谢\s*[。！]?$/,
  /^感谢\s*[。！]?$/,
  /^👍\s*$/,
];

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

const DEFAULT_MIN_TEXTS = 3;

export function compressTexts(
  texts: string[],
  maxChars: number,
  options: { minTexts?: number; minScoreToKeep?: number } = {},
): CompressResult {
  const minTexts = options.minTexts ?? DEFAULT_MIN_TEXTS;
  const minScoreToKeep = options.minScoreToKeep ?? 0.3;

  if (texts.length === 0) {
    return { texts: [], scored: [], dropped: 0, totalChars: 0 };
  }

  const scored = texts.map((t, i) => scoreText(t, i));
  const allChars = texts.reduce((sum, t) => sum + t.length, 0);

  if (allChars <= maxChars) {
    return { texts: [...texts], scored, dropped: 0, totalChars: allChars };
  }

  const selectedIndices = new Set<number>();
  let usedChars = 0;

  const addIndex = (idx: number): boolean => {
    if (selectedIndices.has(idx) || idx < 0 || idx >= texts.length) return false;
    const len = texts[idx].length;
    if (usedChars + len > maxChars) return false;
    selectedIndices.add(idx);
    usedChars += len;
    return true;
  };

  addIndex(0);
  if (texts.length > 1) addIndex(texts.length - 1);

  const candidates = scored
    .filter((s) => s.index !== 0 && s.index !== texts.length - 1)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const pairedWith = new Map<number, number>();
  for (const s of scored) {
    if (
      s.reason === "tool_call" &&
      s.index + 1 < texts.length &&
      !pairedWith.has(s.index) &&
      !pairedWith.has(s.index + 1)
    ) {
      pairedWith.set(s.index, s.index + 1);
      pairedWith.set(s.index + 1, s.index);
    }
  }

  for (const candidate of candidates) {
    if (usedChars >= maxChars) break;
    const added = addIndex(candidate.index);
    if (added) {
      const partner = pairedWith.get(candidate.index);
      if (partner !== undefined) addIndex(partner);
    }
  }

  const allLow = scored.every((s) => s.score < minScoreToKeep);
  if (allLow && selectedIndices.size < Math.min(minTexts, texts.length)) {
    for (let i = texts.length - 1; i >= 0 && selectedIndices.size < Math.min(minTexts, texts.length); i--) {
      addIndex(i);
    }
  }

  const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
  const resultTexts = sortedIndices.map((i) => texts[i]);
  const totalChars = resultTexts.reduce((sum, t) => sum + t.length, 0);

  return {
    texts: resultTexts,
    scored,
    dropped: texts.length - sortedIndices.length,
    totalChars,
  };
}

export function estimateConversationValue(texts: string[]): number {
  if (texts.length === 0) return 0;
  let value = 0;
  const joined = texts.join(" ");

  const MEMORY_INTENT = /\b(remember|recall|don'?t forget|note that|keep in mind)\b/i;
  const MEMORY_INTENT_CJK = /(记住|別忘|不要忘|记一下)/;
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
