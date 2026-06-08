/**
 * core/verify/verify-text.ts — Text analysis helpers for verification.
 */
const stopwords = new Set([
    '的',
    '了',
    '是',
    '在',
    '我',
    '有',
    '和',
    '就',
    '不',
    '人',
    '都',
    '一',
    '一个',
    '上',
    '也',
    '很',
    '到',
    '说',
    '要',
    '去',
    '你',
    '会',
    '着',
    '没有',
    '看',
    '好',
    '自己',
    '这',
    '那',
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'under',
    'again',
    'further',
    'then',
    'once',
    'here',
    'there',
    'when',
    'where',
    'why',
    'how',
    'all',
    'each',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'not',
    'only',
    'own',
    'same',
    'so',
    'than',
    'too',
    'very',
    'just',
    'now',
]);
export function extractKeywords(text) {
    const lower = text.toLowerCase();
    const tokens = [];
    const chineseChars = lower.match(/[\u4e00-\u9fff]/g) || [];
    for (const ch of chineseChars) {
        if (!stopwords.has(ch))
            tokens.push(ch);
    }
    for (let i = 0; i < chineseChars.length - 1; i++) {
        const bigram = chineseChars[i] + chineseChars[i + 1];
        if (!stopwords.has(bigram))
            tokens.push(bigram);
    }
    const words = lower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !stopwords.has(w));
    tokens.push(...words);
    return tokens;
}
export function hasNegation(text) {
    const negations = [
        '不',
        '没',
        '无',
        '未',
        '别',
        '莫',
        '否',
        '非',
        'no',
        'not',
        'never',
        'none',
        'without',
        "don't",
        "doesn't",
        "didn't",
        "won't",
        "can't",
        "isn't",
        "aren't",
        "wasn't",
        "weren't",
        "haven't",
        "hasn't",
        "hadn't",
    ];
    const lower = text.toLowerCase();
    return negations.some((n) => lower.includes(n.toLowerCase()));
}
/** Hybrid overlap: Chinese character inclusion + English word Jaccard */
export function hybridOverlap(claim, snippet) {
    const claimChars = new Set(claim.match(/[\u4e00-\u9fff]/g) || []);
    const snippetChars = new Set(snippet.match(/[\u4e00-\u9fff]/g) || []);
    let charMatches = 0;
    for (const ch of claimChars) {
        if (snippetChars.has(ch))
            charMatches++;
    }
    const charScore = claimChars.size > 0 ? charMatches / claimChars.size : 0;
    const claimWords = extractKeywords(claim).filter((w) => /[a-z]/.test(w));
    const snippetWords = extractKeywords(snippet).filter((w) => /[a-z]/.test(w));
    let wordScore = 0;
    if (claimWords.length > 0 && snippetWords.length > 0) {
        const setA = new Set(claimWords);
        const setB = new Set(snippetWords);
        const intersection = new Set([...setA].filter((x) => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        wordScore = union.size === 0 ? 0 : intersection.size / union.size;
    }
    if (claimWords.length === 0)
        return charScore;
    if (claimChars.size === 0)
        return wordScore;
    return charScore * 0.6 + wordScore * 0.4;
}
