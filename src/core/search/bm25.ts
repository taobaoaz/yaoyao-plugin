/**
 * BM25 Scorer — 稀疏向量关键词权重评分。
 * 腾讯方案：BM25 编码器增强搜索质量，支持中英文混合。
 * 纯正则/数学实现，零外部依赖。
 */

// ── English suffix stripping rules (zero-dependency lemmatization) ──

/**
 * Lightweight English suffix stripping for BM25 matching.
 * mem0 reference: mem0/utils/lemmatization.py
 *
 * Strips common suffixes to normalize verb forms, plurals, etc.
 * Preserves -ing forms alongside stripped forms to handle noun/verb ambiguity.
 * Preserves short words (≤3 chars) unchanged.
 */
function stripEnglishSuffix(word: string): { stem: string; preserveOriginal: boolean } {
  if (word.length <= 3) return { stem: word, preserveOriginal: false };

  const original = word;
  let stem = word;
  let preserveOriginal = false;

  // -ies → -y (e.g., memories → memory, carries → carry)
  // Exception: ties, dies, lies → keep as-is
  if (stem.endsWith("ies") && stem.length > 4 && !["ties", "dies", "lies"].includes(stem)) {
    stem = stem.slice(0, -3) + "y";
  }
  // -ves → -f (e.g., shelves → shelf, wolves → wolf)
  else if (stem.endsWith("ves") && stem.length > 4) {
    stem = stem.slice(0, -3) + "f";
  }
  // -es after s/sh/ch/x/z/o → drop -es (e.g., watches → watch, boxes → box, goes → go)
  else if (stem.endsWith("es") && stem.length > 4) {
    const base = stem.slice(0, -2);
    if (/[szx]$|[sc]h$|o$/.test(base)) {
      stem = base;
    } else if (stem.endsWith("ies")) {
      // already handled above
    } else {
      stem = stem.slice(0, -1); // standard -s drop
    }
  }
  // -ing → drop -ing (e.g., running → run, coding → code)
  // Preserve -ing forms for noun/verb ambiguity (meeting, building)
  else if (stem.endsWith("ing") && stem.length > 5) {
    const base = stem.slice(0, -3);
    // Double consonant → single (running → run, stopping → stop)
    if (/(.)\1$/.test(base)) {
      stem = base.slice(0, -1);
    } else if (base.endsWith("ck") || base.endsWith("sh") || base.endsWith("ch")) {
      stem = base;
    } else if (base.endsWith("e")) {
      stem = base; // keeping → keep
    } else {
      stem = base;
    }
    preserveOriginal = true; // keep -ing form too
  }
  // -ed → drop -ed (e.g., walked → walk, used → use, stopped → stop)
  else if (stem.endsWith("ed") && stem.length > 4 && !stem.endsWith("eed")) {
    const base = stem.slice(0, -2);
    // Double consonant (stopped → stop)
    if (/(.)\1$/.test(base)) {
      stem = base.slice(0, -1);
    } else if (base.endsWith("i")) {
      stem = base.slice(0, -1) + "y"; // carried → carry
    } else {
      stem = base;
    }
  }
  // -ly → drop -ly (e.g., quickly → quick)
  else if (stem.endsWith("ly") && stem.length > 5) {
    stem = stem.slice(0, -2);
  }
  // -s (but not -ss) → drop -s for plural (e.g., cats → cat)
  else if (stem.endsWith("s") && !stem.endsWith("ss") && stem.length > 4) {
    stem = stem.slice(0, -1);
  }

  // -tion / -sion → -t (e.g., extraction → extract, decision → decide)
  if (stem.endsWith("tion") && stem.length > 6) {
    stem = stem.slice(0, -4) + "t";
  } else if (stem.endsWith("sion") && stem.length > 5) {
    stem = stem.slice(0, -4);
  }
  // -ment → drop (e.g., management → manage)
  else if (stem.endsWith("ment") && stem.length > 6) {
    stem = stem.slice(0, -4);
  }

  return { stem, preserveOriginal };
}

/** Check if text contains CJK characters */
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

// ── Chinese word segmentation: bigram for CJK (mem0-style CJK support) ──

/**
 * Segment Chinese text into overlapping bigrams.
 * Monogram + bigram covers common 2-character compounds.
 */
function segmentChinese(text: string): string[] {
  const chars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  if (chars.length === 0) return [];
  const terms: string[] = [...chars]; // unigrams
  // overlapping bigrams
  for (let i = 0; i < chars.length - 1; i++) {
    terms.push(chars[i] + chars[i + 1]);
  }
  return terms;
}

/** Tokenize text into terms with lemmatization and CJK bigram support. */
export function tokenize(text: string): string[] {
  const terms: string[] = [];

  // English words with lemmatization
  const enWords = text.match(/[a-zA-Z]+/g) || [];
  for (const w of enWords) {
    const lower = w.toLowerCase();
    terms.push(lower); // always include raw form
    const { stem, preserveOriginal } = stripEnglishSuffix(lower);
    if (stem !== lower) {
      terms.push(stem);
    }
    if (preserveOriginal && lower.endsWith("ing")) {
      // Keep -ing form (handles noun/verb ambiguity like "meeting", "building")
      // Already added as raw form above
    }
  }

  // Chinese bigram (better than single-char for BM25 matching)
  if (hasCJK(text)) {
    terms.push(...segmentChinese(text));
  }

  return terms;
}

/** Compute term frequency map */
function computeTF(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of terms) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  return tf;
}

/** Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1) */
function computeIDF(totalDocs: number, docFreq: number): number {
  return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}

export interface BM25Config {
  /** Term frequency saturation parameter (default: 1.2) */
  k1?: number;
  /** Length normalization parameter (default: 0.75) */
  b?: number;
  /** Language mode: "zh" = Chinese heavy, "en" = English heavy, "mixed" = auto (default) */
  language?: "zh" | "en" | "mixed";
}

export interface BM25Document {
  id: string;
  text: string;
  tf: Map<string, number>;
  length: number;
}

export interface BM25Index {
  docs: BM25Document[];
  docFreq: Map<string, number>;
  avgDocLen: number;
  totalDocs: number;
}

/** Build BM25 index from documents */
export function buildBM25Index(texts: string[], ids?: string[]): BM25Index {
  const docs: BM25Document[] = [];
  let totalLen = 0;
  const docFreq = new Map<string, number>();

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const terms = tokenize(text);
    const tf = computeTF(terms);
    const len = terms.length || 1;
    totalLen += len;
    docs.push({ id: ids?.[i] || String(i), text, tf, length: len });

    // Update document frequency
    for (const term of new Set(terms)) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const avgDocLen = totalLen / (docs.length || 1);
  return { docs, docFreq, avgDocLen, totalDocs: docs.length };
}

/** Score a query against the BM25 index */
export function scoreBM25(index: BM25Index, query: string, config?: BM25Config): Array<{ id: string; score: number; text: string }> {
  const k1 = config?.k1 ?? 1.2;
  const b = config?.b ?? 0.75;
  const qTerms = tokenize(query);
  const qUnique = [...new Set(qTerms)];

  const results: Array<{ id: string; score: number; text: string }> = [];

  for (const doc of index.docs) {
    let score = 0;
    for (const term of qUnique) {
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      const df = index.docFreq.get(term) || 1;
      const idf = computeIDF(index.totalDocs, df);
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (doc.length / index.avgDocLen));
      score += idf * (numerator / denominator);
    }
    if (score > 0) {
      results.push({ id: doc.id, score, text: doc.text });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/** Quick BM25 search over a string array */
export function bm25Search(docs: string[], query: string, config?: BM25Config): Array<{ index: number; score: number }> {
  const index = buildBM25Index(docs);
  const scored = scoreBM25(index, query, config);
  return scored.map(r => ({ index: parseInt(r.id, 10), score: r.score }));
}

// ── BM25 Score Normalization (mem0 v3 inspired) ──

/**
 * Get sigmoid normalization parameters based on query length.
 * Longer queries tend to have higher raw BM25 scores.
 * mem0 reference: mem0/utils/scoring.py → get_bm25_params()
 */
export function getBM25SigmoidParams(query: string): { midpoint: number; steepness: number } {
  const numTerms = tokenize(query).length;
  if (numTerms <= 3) return { midpoint: 5.0, steepness: 0.7 };
  if (numTerms <= 6) return { midpoint: 7.0, steepness: 0.6 };
  if (numTerms <= 9) return { midpoint: 9.0, steepness: 0.5 };
  if (numTerms <= 15) return { midpoint: 10.0, steepness: 0.5 };
  return { midpoint: 12.0, steepness: 0.5 };
}

/**
 * Normalize a raw BM25 score to [0, 1] using logistic sigmoid.
 * mem0 reference: mem0/utils/scoring.py → normalize_bm25()
 *
 * @param rawScore Raw BM25 score (unbounded, typically 0-20+)
 * @param params Sigmoid params from getBM25SigmoidParams()
 * @returns Normalized score in [0, 1]
 */
export function normalizeBM25Score(rawScore: number, params: { midpoint: number; steepness: number }): number {
  return 1 / (1 + Math.exp(-params.steepness * (rawScore - params.midpoint)));
}
