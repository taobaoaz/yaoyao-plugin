/**
 * core/verify.ts — Anti-hallucination verification engine.
 *
 * Pure local rule-based fact-checking against text snippets.
 * No LLM calls. Hybrid scoring: Chinese char overlap + English word Jaccard.
 */
/** Speculative language markers that indicate low-confidence AI output */
export const SPECULATIVE_MARKERS = [
    "我认为", "我觉得", "我猜", "我推测", "我假设",
    "可能", "也许", "大概", "或许", "说不定",
    "应该", "似乎", "好像", "看起来", "据我了解",
    "不确定", "不太确定", "我不确定",
    "I think", "I guess", "I suppose", "maybe", "perhaps",
    "probably", "likely", "seems", "appears", "I assume",
    "not sure", "uncertain", "I believe",
];
/** User correction markers that dispute AI claims */
export const CORRECTION_MARKERS = [
    "不对", "错了", "不是", "没有", "不准确", "不完全",
    "你记错了", "你说错了", "并非如此", "不完全是",
    "no", "wrong", "incorrect", "not exactly", "that's not",
    "you're wrong", "not true", "false",
];
/** Detect speculative language in text */
export function detectSpeculative(text) {
    if (typeof text !== "string") {
        return { isSpeculative: false, markers: [], confidence: "high" };
    }
    if (text.length === 0) {
        return { isSpeculative: false, markers: [], confidence: "high" };
    }
    const lower = text.toLowerCase();
    const found = SPECULATIVE_MARKERS.filter(m => lower.includes(m.toLowerCase()));
    const density = found.length / Math.max(text.length / 50, 1);
    let confidence = "high";
    if (found.length >= 3 || density > 0.5)
        confidence = "low";
    else if (found.length >= 1 || density > 0.2)
        confidence = "medium";
    return {
        isSpeculative: found.length > 0,
        markers: found,
        confidence,
    };
}
/** Detect user corrections that dispute AI claims */
export function detectCorrection(text) {
    if (typeof text !== "string") {
        return { isCorrection: false, markers: [] };
    }
    if (text.length === 0) {
        return { isCorrection: false, markers: [] };
    }
    const lower = text.toLowerCase();
    const found = CORRECTION_MARKERS.filter(m => lower.includes(m.toLowerCase()));
    return {
        isCorrection: found.length > 0,
        markers: found,
    };
}
/** Score how well a claim is supported by memory snippets */
export function scoreEvidence(claim, snippets) {
    if (typeof claim !== "string" || claim.length === 0) {
        return {
            verdict: "unconfirmed",
            confidence: 0,
            evidence: [],
            reasoning: "待验证的说法为空或无效。",
        };
    }
    // Defensive: validate snippets array structure
    let validSnippets = [];
    if (Array.isArray(snippets)) {
        validSnippets = snippets.filter((s) => s != null &&
            typeof s.snippet === "string" &&
            typeof s.filename === "string");
    }
    if (validSnippets.length === 0) {
        return {
            verdict: "unconfirmed",
            confidence: 0,
            evidence: [],
            reasoning: "记忆库中无任何相关记录。",
        };
    }
    const scored = validSnippets.map(s => {
        const overlap = hybridOverlap(claim, s.snippet);
        return { ...s, overlap };
    }).sort((a, b) => b.overlap - a.overlap);
    const top = scored[0];
    const highOverlap = scored.filter(s => s.overlap > 0.3);
    // Contradiction detection FIRST
    const negationInClaim = hasNegation(claim);
    const negationInTop = hasNegation(top.snippet);
    if (negationInClaim !== negationInTop && top.overlap > 0.25) {
        return {
            verdict: "contradicted",
            confidence: 0.6,
            evidence: scored.slice(0, 3),
            reasoning: `记忆中相关内容与该说法的否定/肯定方向相反，可能存在矛盾。`,
        };
    }
    let verdict = "unconfirmed";
    let confidence = 0;
    let reasoning = "";
    if (top.overlap > 0.5) {
        verdict = "confirmed";
        confidence = Math.min(top.overlap + 0.1, 0.95);
        reasoning = `记忆中有明确匹配的记录（关键词重叠 ${(top.overlap * 100).toFixed(0)}%）。`;
    }
    else if (top.overlap > 0.2) {
        verdict = "partial";
        confidence = top.overlap;
        reasoning = `记忆中有部分相关内容（关键词重叠 ${(top.overlap * 100).toFixed(0)}%），但不完全匹配。`;
    }
    else if (highOverlap.length >= 2) {
        verdict = "partial";
        confidence = 0.4;
        reasoning = `多条记忆中有间接相关内容，但没有单一强匹配。`;
    }
    else {
        verdict = "unconfirmed";
        confidence = Math.max(top.overlap, 0.1);
        reasoning = `记忆中找不到直接支持该说法的证据（最高重叠 ${(top.overlap * 100).toFixed(0)}%）。`;
    }
    return {
        verdict,
        confidence,
        evidence: scored.slice(0, 3),
        reasoning,
    };
}
/** Hybrid overlap: Chinese character inclusion + English word Jaccard */
function hybridOverlap(claim, snippet) {
    const claimChars = new Set(claim.match(/[\u4e00-\u9fff]/g) || []);
    const snippetChars = new Set(snippet.match(/[\u4e00-\u9fff]/g) || []);
    let charMatches = 0;
    for (const ch of claimChars) {
        if (snippetChars.has(ch))
            charMatches++;
    }
    const charScore = claimChars.size > 0 ? charMatches / claimChars.size : 0;
    const claimWords = extractKeywords(claim).filter(w => /[a-z]/.test(w));
    const snippetWords = extractKeywords(snippet).filter(w => /[a-z]/.test(w));
    let wordScore = 0;
    if (claimWords.length > 0 && snippetWords.length > 0) {
        const setA = new Set(claimWords);
        const setB = new Set(snippetWords);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        wordScore = union.size === 0 ? 0 : intersection.size / union.size;
    }
    if (claimWords.length === 0)
        return charScore;
    if (claimChars.size === 0)
        return wordScore;
    return charScore * 0.6 + wordScore * 0.4;
}
/** Extract meaningful keywords from text */
function extractKeywords(text) {
    const stopwords = new Set([
        "的", "了", "是", "在", "我", "有", "和", "就", "不", "人",
        "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去",
        "你", "会", "着", "没有", "看", "好", "自己", "这", "那",
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "have", "has", "had", "do", "does", "did", "will", "would",
        "could", "should", "may", "might", "can", "this", "that",
        "these", "those", "i", "you", "he", "she", "it", "we", "they",
        "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "as", "into", "through", "during", "before", "after",
        "above", "below", "between", "under", "again", "further",
        "then", "once", "here", "there", "when", "where", "why",
        "how", "all", "each", "few", "more", "most", "other", "some",
        "such", "no", "nor", "not", "only", "own", "same", "so",
        "than", "too", "very", "just", "now",
    ]);
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
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopwords.has(w));
    tokens.push(...words);
    return tokens;
}
/** Detect negation in text */
function hasNegation(text) {
    const negations = ["不", "没", "无", "未", "别", "莫", "否", "非", "no", "not", "never", "none", "without", "don't", "doesn't", "didn't", "won't", "can't", "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't", "hadn't"];
    const lower = text.toLowerCase();
    return negations.some(n => lower.includes(n.toLowerCase()));
}
