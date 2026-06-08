/**
 * utils/compressor-core.ts — Core compression logic.
 */
import type { ScoredText, CompressResult } from './session-compressor.ts';
import { scoreText } from './session-compressor.ts';

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
      s.reason === 'tool_call' &&
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
    for (
      let i = texts.length - 1;
      i >= 0 && selectedIndices.size < Math.min(minTexts, texts.length);
      i--
    ) {
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
