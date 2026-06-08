/**
 * storage/fts-cjk.ts — CJK bigram extraction for LIKE fallback.
 */

/**
 * Extract CJK bigrams (2-character sliding windows) from query.
 * Local memory system pattern: for short CJK queries that FTS5's trigram minimum
 * can't match, fall back to LIKE with bigram expansion.
 */
export function extractCjkBigrams(query: string): string[] {
  const bigrams: string[] = [];
  const safe = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  for (let i = 0; i < safe.length - 1; i++) {
    const pair = safe.slice(i, i + 2);
    let hasCjk = false;
    for (let j = 0; j < pair.length; j++) {
      const cp = pair.charCodeAt(j);
      if (
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0x2e80 && cp <= 0x2eff) ||
        cp === 0x3005 ||
        cp === 0x3006
      ) {
        hasCjk = true;
        break;
      }
    }
    if (hasCjk) bigrams.push(pair);
  }
  return bigrams;
}
