/**
 * utils/chunker-split.ts — Split point finding for chunking.
 */
import type { ChunkerConfig } from './chunker.ts';

export const SENTENCE_ENDING = /[.!?。！？]/;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function countLines(s: string): number {
  return s.split(/\r\n|\n|\r/).length;
}

export function findSplitEnd(
  text: string,
  start: number,
  maxEnd: number,
  minEnd: number,
  config: ChunkerConfig,
): number {
  const safeMinEnd = clamp(minEnd, start + 1, maxEnd);
  const safeMaxEnd = clamp(maxEnd, safeMinEnd, text.length);

  if (config.maxLinesPerChunk > 0) {
    const candidate = text.slice(start, safeMaxEnd);
    if (countLines(candidate) > config.maxLinesPerChunk) {
      let breaks = 0;
      for (let i = start; i < safeMaxEnd; i++) {
        if (text[i] === '\n') {
          breaks++;
          if (breaks >= config.maxLinesPerChunk) {
            return Math.max(i + 1, safeMinEnd);
          }
        }
      }
    }
  }

  if (config.semanticSplit) {
    for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
      if (SENTENCE_ENDING.test(text[i])) {
        let j = i + 1;
        while (j < safeMaxEnd && /\s/.test(text[j])) j++;
        return j;
      }
    }

    for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
      if (text[i] === '\n') return i + 1;
    }
  }

  for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
    if (/\s/.test(text[i])) return i;
  }

  return safeMaxEnd;
}
