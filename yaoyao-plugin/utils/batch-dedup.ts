/**
 * Batch Dedup — Text-based deduplication within extraction batches (from Brain v1.1.0)
 * Zero external dependency. Replaces cosine similarity with Jaccard + Levenshtein.
 */

export interface BatchDedupCandidate {
  index: number;
  text: string;
  isBatchDuplicate: boolean;
  duplicateOf?: number;
}

export interface BatchDedupResult {
  survivingIndices: number[];
  duplicateIndices: number[];
  inputCount: number;
  outputCount: number;
}

/** Simple trigram Jaccard similarity (0-1). */
function trigramJaccard(a: string, b: string): number {
  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const norm = s.toLowerCase().replace(/\s+/g, " ").trim();
    for (let i = 0; i <= norm.length - 3; i++) {
      set.add(norm.slice(i, i + 3));
    }
    return set;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = new Set([...ta].filter((x) => tb.has(x)));
  const union = new Set([...ta, ...tb]);
  return intersection.size / union.size;
}

/** Quick Levenshtein distance for short texts. */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/** Simple trigram Jaccard similarity (0-1). */
export function textSimilarity(a: string, b: string): number {
  const jaccard = trigramJaccard(a, b);
  // For short texts, boost with Levenshtein
  if (a.length < 100 && b.length < 100) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 0;
    const levSim = 1 - levenshtein(a, b) / maxLen;
    return jaccard * 0.7 + levSim * 0.3;
  }
  return jaccard;
}

/**
 * Check if `candidate` is a duplicate of any recent memory in the DB.
 * Queries the last `lookback` memories and returns true if similarity >= threshold.
 */
export function isDuplicateOfRecent(
  candidate: string,
  recentMemories: { snippet: string }[],
  threshold = 0.85,
): boolean {
  for (const mem of recentMemories) {
    if (textSimilarity(candidate, mem.snippet) >= threshold) {
      return true;
    }
  }
  return false;
}

export function batchDedup(
  texts: string[],
  threshold = 0.85,
): BatchDedupResult {
  if (texts.length === 0) {
    return { survivingIndices: [], duplicateIndices: [], inputCount: 0, outputCount: 0 };
  }

  const candidates: BatchDedupCandidate[] = texts.map((text, index) => ({
    index,
    text,
    isBatchDuplicate: false,
  }));

  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].isBatchDuplicate) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidates[j].isBatchDuplicate) continue;
      const sim = textSimilarity(candidates[i].text, candidates[j].text);
      if (sim >= threshold) {
        candidates[j].isBatchDuplicate = true;
        candidates[j].duplicateOf = i;
      }
    }
  }

  const survivingIndices = candidates
    .filter((c) => !c.isBatchDuplicate)
    .map((c) => c.index);
  const duplicateIndices = candidates
    .filter((c) => c.isBatchDuplicate)
    .map((c) => c.index);

  return {
    survivingIndices,
    duplicateIndices,
    inputCount: texts.length,
    outputCount: survivingIndices.length,
  };
}
