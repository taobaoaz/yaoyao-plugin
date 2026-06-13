/**
 * core/search/enhanced.ts — Enhanced search algorithms (pure logic).
 */

/**
 * Highlight matching keywords in text with ** markers.
 * Case-insensitive, supports CJK.
 */
export function highlightKeywords(text: string, keywords: string[]): string {
  if (typeof text !== "string") throw new TypeError("highlightKeywords: text must be a string");
  if (!Array.isArray(keywords)) throw new TypeError("highlightKeywords: keywords must be an array");

  let result = text;
  for (const kw of keywords) {
    if (!kw || kw.length < 2) continue;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const safeKw = escaped.slice(0, 100);
    try {
      const regex = new RegExp(`(${safeKw})`, "gi");
      result = result.replace(regex, " **$1** ");
    } catch { /* skip invalid regex */ }
  }
  return result.replace(/\s{2,}/g, " ");
}

/**
 * Extract keywords from text for highlighting and search.
 */
export function extractKeywords(text: string): string[] {
  if (typeof text !== "string") throw new TypeError("extractKeywords: text must be a string");

  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2);

  const stopwords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们",
    "吗", "吧", "呢", "啊", "哦", "哈", "嗯", "嘛", "哟",
    "还是", "或者", "但是", "因为", "所以", "如果", "虽然", "而且", "然后", "可以",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
    "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
    "those", "and", "or", "but", "if", "because", "when", "where", "how",
    "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "not", "no", "yes",
  ]);
  return words.filter(w => !stopwords.has(w) && w.length < 30);
}

/**
 * Cosine similarity between two Float32Array vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (!ArrayBuffer.isView(a) || !(a instanceof Float32Array)) throw new TypeError("cosineSimilarity: a must be a Float32Array");
  if (!ArrayBuffer.isView(b) || !(b instanceof Float32Array)) throw new TypeError("cosineSimilarity: b must be a Float32Array");
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
