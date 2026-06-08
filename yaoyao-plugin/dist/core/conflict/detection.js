/**
 * core/conflict/detection.ts — Conflict detection and relation management.
 *
 * Pure detection logic. No formatting.
 */
import { tokenizeText, rougeLikeF1 } from "../../utils/confidence-scorer.js";
import { textSimilarity } from "../../utils/batch-dedup.js";
import { CONTRADICTION_MARKERS, PREFERENCE_MARKERS, DECISION_MARKERS, DETECT_DEFAULTS, } from "./types.js";
/**
 * Detect potential conflicts between new content and existing memories.
 */
export function detectConflicts(newContent, existingMemories, options = {}) {
    const { minConfidence, maxCandidates } = { ...DETECT_DEFAULTS, ...options };
    if (!newContent || existingMemories.length === 0)
        return [];
    const candidates = [];
    const newTokens = tokenizeText(newContent);
    for (const mem of existingMemories) {
        const snippet = mem.snippet ?? '';
        if (!snippet || snippet.length < 10)
            continue;
        const lexicalSim = textSimilarity(newContent, snippet);
        if (lexicalSim < minConfidence)
            continue;
        const memTokens = tokenizeText(snippet);
        const rougeF1 = rougeLikeF1(newTokens, memTokens);
        const semanticOverlap = (lexicalSim + rougeF1) / 2;
        const lengthRatio = Math.min(newContent.length, snippet.length) / Math.max(newContent.length, snippet.length);
        const hasContradiction = CONTRADICTION_MARKERS.some((m) => m.test(snippet) || m.test(newContent));
        const hasPreference = PREFERENCE_MARKERS.some((m) => m.test(snippet) || m.test(newContent));
        const hasDecision = DECISION_MARKERS.some((m) => m.test(snippet) || m.test(newContent));
        const signals = {
            lexicalSimilarity: lexicalSim,
            semanticOverlap,
            hasContradictionMarkers: hasContradiction,
            lengthRatio,
        };
        // Confidence scoring
        let confidence = semanticOverlap * 0.5 + lexicalSim * 0.3;
        if (hasContradiction && hasPreference)
            confidence += 0.2;
        if (hasDecision)
            confidence += 0.1;
        if (lengthRatio < 0.3)
            confidence *= 0.7;
        const finalConfidence = Math.min(1, Math.max(0, confidence));
        if (finalConfidence < minConfidence)
            continue;
        const reasons = [];
        if (hasContradiction && hasPreference)
            reasons.push('含矛盾偏好');
        else if (hasContradiction)
            reasons.push('含矛盾表述');
        if (lexicalSim > 0.8)
            reasons.push('文本高度重叠');
        if (lengthRatio > 0.8 && newContent.length > 100)
            reasons.push('内容长度相似');
        reasons.push(`语义重叠 ${(semanticOverlap * 100).toFixed(0)}%`);
        candidates.push({
            memoryId: mem.id ?? -1,
            date: mem.date ?? '',
            snippet,
            confidence: finalConfidence,
            reason: reasons.join('; '),
            signals,
        });
    }
    return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, maxCandidates);
}
