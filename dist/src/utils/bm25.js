/**
 * BM25 Scorer — 稀疏向量关键词权重评分。
 * 腾讯方案：BM25 编码器增强搜索质量，支持中英文混合。
 * 纯正则/数学实现，零外部依赖。
 */
/** Tokenize text into terms (Chinese char + English words) */
export function tokenize(text) {
    const terms = [];
    // English words
    const enWords = text.match(/[a-zA-Z]+/g) || [];
    terms.push(...enWords.map(w => w.toLowerCase()));
    // Chinese characters (each char is a term)
    const cnChars = text.match(/[\u4e00-\u9fff]/g) || [];
    terms.push(...cnChars);
    return terms;
}
/** Compute term frequency map */
function computeTF(terms) {
    const tf = new Map();
    for (const t of terms) {
        tf.set(t, (tf.get(t) || 0) + 1);
    }
    return tf;
}
/** Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1) */
function computeIDF(totalDocs, docFreq) {
    return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}
/** Build BM25 index from documents */
export function buildBM25Index(texts, ids) {
    const docs = [];
    let totalLen = 0;
    const docFreq = new Map();
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
export function scoreBM25(index, query, config) {
    const k1 = config?.k1 ?? 1.2;
    const b = config?.b ?? 0.75;
    const qTerms = tokenize(query);
    const qUnique = [...new Set(qTerms)];
    const results = [];
    for (const doc of index.docs) {
        let score = 0;
        for (const term of qUnique) {
            const tf = doc.tf.get(term) || 0;
            if (tf === 0)
                continue;
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
export function bm25Search(docs, query, config) {
    const index = buildBM25Index(docs);
    const scored = scoreBM25(index, query, config);
    return scored.map(r => ({ index: parseInt(r.id, 10), score: r.score }));
}
