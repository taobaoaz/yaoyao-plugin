/**
 * Confidence Scorer — CJK-friendly text similarity + ROUGE-like F1
 * 从 Brain (memory-lancedb-pro) admission-control.ts 学习
 * 零外部依赖，纯本地
 */
function isHanChar(char) {
    return /\p{Script=Han}/u.test(char);
}
function isWordChar(char) {
    return /[\p{Letter}\p{Number}]/u.test(char);
}
/** CJK-friendly tokenization */
export function tokenizeText(value) {
    const normalized = value.toLowerCase().trim();
    const tokens = [];
    let current = '';
    for (const char of normalized) {
        if (isHanChar(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            tokens.push(char);
            continue;
        }
        if (isWordChar(char)) {
            current += char;
            continue;
        }
        if (current) {
            tokens.push(current);
            current = '';
        }
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}
/** Longest common subsequence length */
export function lcsLength(left, right) {
    if (left.length === 0 || right.length === 0)
        return 0;
    const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            if (left[i - 1] === right[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[left.length][right.length];
}
/** ROUGE-like F1 score for text similarity */
export function rougeLikeF1(left, right) {
    if (left.length === 0 || right.length === 0)
        return 0;
    const lcs = lcsLength(left, right);
    if (lcs === 0)
        return 0;
    const precision = lcs / left.length;
    const recall = lcs / right.length;
    if (precision + recall === 0)
        return 0;
    return (2 * precision * recall) / (precision + recall);
}
function splitSupportSpans(conversationText) {
    const spans = new Set();
    for (const line of conversationText.split(/\n+/)) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        spans.add(trimmed);
        for (const sentence of trimmed.split(/[。！？!?]+/)) {
            const candidate = sentence.trim();
            if (candidate.length >= 4) {
                spans.add(candidate);
            }
        }
    }
    return Array.from(spans);
}
/** Score how well a candidate memory is supported by conversation text */
export function scoreConfidenceSupport(candidateText, conversationText) {
    const candidateTokens = tokenizeText(candidateText);
    if (candidateTokens.length === 0) {
        return { score: 0, bestSupport: 0, coverage: 0, unsupportedRatio: 1 };
    }
    const spans = splitSupportSpans(conversationText);
    const conversationTokens = new Set(tokenizeText(conversationText));
    let bestSupport = 0;
    for (const span of spans) {
        const spanTokens = tokenizeText(span);
        bestSupport = Math.max(bestSupport, rougeLikeF1(candidateTokens, spanTokens));
    }
    const uniqueCandidateTokens = Array.from(new Set(candidateTokens));
    const supportedTokenCount = uniqueCandidateTokens.filter((token) => conversationTokens.has(token)).length;
    const coverage = uniqueCandidateTokens.length > 0 ? supportedTokenCount / uniqueCandidateTokens.length : 0;
    const unsupportedRatio = uniqueCandidateTokens.length > 0 ? 1 - coverage : 1;
    const rawScore = bestSupport * 0.7 + coverage * 0.3 - unsupportedRatio * 0.25;
    const score = Math.min(1, Math.max(0, rawScore));
    return { score, bestSupport, coverage, unsupportedRatio };
}
