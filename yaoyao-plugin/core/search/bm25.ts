/**
 * BM25 Scorer — 稀疏向量关键词权重评分。
 * 腾讯方案：BM25 编码器增强搜索质量，支持中英文混合。
 * 纯正则/数学实现，零外部依赖。
 */
import { tokenize } from './bm25-tokenize.ts';

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
  language?: 'zh' | 'en' | 'mixed';
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

    for (const term of new Set(terms)) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const avgDocLen = totalLen / (docs.length || 1);
  return { docs, docFreq, avgDocLen, totalDocs: docs.length };
}

/** Score a query against the BM25 index */
export function scoreBM25(
  index: BM25Index,
  query: string,
  config?: BM25Config,
): Array<{ id: string; score: number; text: string }> {
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
export function bm25Search(
  docs: string[],
  query: string,
  config?: BM25Config,
): Array<{ index: number; score: number }> {
  const index = buildBM25Index(docs);
  const scored = scoreBM25(index, query, config);
  return scored.map((r) => ({ index: parseInt(r.id, 10), score: r.score }));
}

// ── BM25 Score Normalization ──

/** Get sigmoid normalization parameters based on query length. */
export function getBM25SigmoidParams(query: string): { midpoint: number; steepness: number } {
  const numTerms = tokenize(query).length;
  if (numTerms <= 3) return { midpoint: 5.0, steepness: 0.7 };
  if (numTerms <= 6) return { midpoint: 7.0, steepness: 0.6 };
  if (numTerms <= 9) return { midpoint: 9.0, steepness: 0.5 };
  if (numTerms <= 15) return { midpoint: 10.0, steepness: 0.5 };
  return { midpoint: 12.0, steepness: 0.5 };
}

/** Normalize a raw BM25 score to [0, 1] using logistic sigmoid. */
export function normalizeBM25Score(
  rawScore: number,
  params: { midpoint: number; steepness: number },
): number {
  return 1 / (1 + Math.exp(-params.steepness * (rawScore - params.midpoint)));
}
