/**
 * core/search/bm25-tokenize.ts — BM25 tokenization with CJK support.
 */

/** Check if text contains CJK characters */
export function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * Segment Chinese text into overlapping bigrams.
 * Monogram + bigram covers common 2-character compounds.
 */
export function segmentChinese(text: string): string[] {
  const chars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  if (chars.length === 0) return [];
  const terms: string[] = [...chars]; // unigrams
  // overlapping bigrams
  for (let i = 0; i < chars.length - 1; i++) {
    terms.push(chars[i] + chars[i + 1]);
  }
  return terms;
}

/**
 * Lightweight English suffix stripping for BM25 matching.
 */
export function stripEnglishSuffix(word: string): { stem: string; preserveOriginal: boolean } {
  if (word.length <= 3) return { stem: word, preserveOriginal: false };

  const lower = word.toLowerCase();
  let stem = lower;
  let preserveOriginal = false;

  if (stem.endsWith("ies") && stem.length > 4 && !["ties", "dies", "lies"].includes(stem)) {
    stem = stem.slice(0, -3) + "y";
  } else if (stem.endsWith("ves") && stem.length > 4) {
    stem = stem.slice(0, -3) + "f";
  } else if (stem.endsWith("es") && stem.length > 4) {
    const base = stem.slice(0, -2);
    if (/[szx]$|[sc]h$|o$/.test(base)) {
      stem = base;
    } else {
      stem = stem.slice(0, -1);
    }
  } else if (stem.endsWith("ing") && stem.length > 5) {
    const base = stem.slice(0, -3);
    if (/(.)(\1)$/.test(base)) {
      stem = base.slice(0, -1);
    } else {
      stem = base;
    }
    preserveOriginal = true;
  } else if (stem.endsWith("ed") && stem.length > 4 && !stem.endsWith("eed")) {
    const base = stem.slice(0, -2);
    if (/(.)(\1)$/.test(base)) {
      stem = base.slice(0, -1);
    } else if (base.endsWith("i")) {
      stem = base.slice(0, -1) + "y";
    } else {
      stem = base;
    }
  } else if (stem.endsWith("ly") && stem.length > 5) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith("s") && !stem.endsWith("ss") && stem.length > 4) {
    stem = stem.slice(0, -1);
  }

  if (stem.endsWith("tion") && stem.length > 6) {
    stem = stem.slice(0, -4) + "t";
  } else if (stem.endsWith("sion") && stem.length > 5) {
    stem = stem.slice(0, -4);
  } else if (stem.endsWith("ment") && stem.length > 6) {
    stem = stem.slice(0, -4);
  }

  return { stem, preserveOriginal };
}

/** Tokenize text into terms with lemmatization and CJK bigram support. */
export function tokenize(text: string): string[] {
  const terms: string[] = [];

  const enWords = text.match(/[a-zA-Z]+/g) || [];
  for (const w of enWords) {
    const lower = w.toLowerCase();
    terms.push(lower);
    const { stem } = stripEnglishSuffix(lower);
    if (stem !== lower) terms.push(stem);
  }

  if (hasCJK(text)) {
    terms.push(...segmentChinese(text));
  }

  return terms;
}
