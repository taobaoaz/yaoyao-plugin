/**
 * core/verify.ts — Anti-hallucination verification engine.
 *
 * Pure local rule-based fact-checking against text snippets.
 * No LLM calls. Hybrid scoring: Chinese char overlap + English word Jaccard.
 */
import { SPECULATIVE_MARKERS, CORRECTION_MARKERS } from "./verify-markers.js";
import { hybridOverlap, hasNegation } from "./verify-text.js";
/** Detect speculative language in text */
export function detectSpeculative(text) {
    if (typeof text !== 'string') {
        return { isSpeculative: false, markers: [], confidence: 'high' };
    }
    if (text.length === 0) {
        return { isSpeculative: false, markers: [], confidence: 'high' };
    }
    const lower = text.toLowerCase();
    const found = SPECULATIVE_MARKERS.filter((m) => lower.includes(m.toLowerCase()));
    const density = found.length / Math.max(text.length / 50, 1);
    let confidence = 'high';
    if (found.length >= 3 || density > 0.5)
        confidence = 'low';
    else if (found.length >= 1 || density > 0.2)
        confidence = 'medium';
    return {
        isSpeculative: found.length > 0,
        markers: found,
        confidence,
    };
}
/** Detect user corrections that dispute AI claims */
export function detectCorrection(text) {
    if (typeof text !== 'string') {
        return { isCorrection: false, markers: [] };
    }
    if (text.length === 0) {
        return { isCorrection: false, markers: [] };
    }
    const lower = text.toLowerCase();
    const found = CORRECTION_MARKERS.filter((m) => lower.includes(m.toLowerCase()));
    return {
        isCorrection: found.length > 0,
        markers: found,
    };
}
/** Score how well a claim is supported by memory snippets */
export function scoreEvidence(claim, snippets) {
    if (typeof claim !== 'string' || claim.length === 0) {
        return {
            verdict: 'unconfirmed',
            confidence: 0,
            evidence: [],
            reasoning: '待验证的说法为空或无效。',
        };
    }
    let validSnippets = [];
    if (Array.isArray(snippets)) {
        validSnippets = snippets.filter((s) => s != null &&
            typeof s.snippet === 'string' &&
            typeof s.filename === 'string');
    }
    if (validSnippets.length === 0) {
        return {
            verdict: 'unconfirmed',
            confidence: 0,
            evidence: [],
            reasoning: '记忆库中无任何相关记录。',
        };
    }
    const scored = validSnippets
        .map((s) => {
        const overlap = hybridOverlap(claim, s.snippet);
        return { ...s, overlap };
    })
        .sort((a, b) => b.overlap - a.overlap);
    const top = scored[0];
    const highOverlap = scored.filter((s) => s.overlap > 0.3);
    const negationInClaim = hasNegation(claim);
    const negationInTop = hasNegation(top.snippet);
    if (negationInClaim !== negationInTop && top.overlap > 0.25) {
        return {
            verdict: 'contradicted',
            confidence: 0.6,
            evidence: scored.slice(0, 3),
            reasoning: `记忆中相关内容与该说法的否定/肯定方向相反，可能存在矛盾。`,
        };
    }
    let verdict;
    let confidence;
    let reasoning;
    if (top.overlap > 0.5) {
        verdict = 'confirmed';
        confidence = Math.min(top.overlap + 0.1, 0.95);
        reasoning = `记忆中有明确匹配的记录（关键词重叠 ${(top.overlap * 100).toFixed(0)}%）。`;
    }
    else if (top.overlap > 0.2) {
        verdict = 'partial';
        confidence = top.overlap;
        reasoning = `记忆中有部分相关内容（关键词重叠 ${(top.overlap * 100).toFixed(0)}%），但不完全匹配。`;
    }
    else if (highOverlap.length >= 2) {
        verdict = 'partial';
        confidence = 0.4;
        reasoning = `多条记忆中有间接相关内容，但没有单一强匹配。`;
    }
    else {
        verdict = 'unconfirmed';
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
