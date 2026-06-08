/**
 * Long Context Chunking System
 * 从 Brain (memory-lancedb-pro) 学习：CJK 友好的语义分块
 * 零外部依赖，纯本地
 */
export const DEFAULT_CHUNKER_CONFIG = {
    maxChunkSize: 4000,
    overlapSize: 200,
    minChunkSize: 200,
    semanticSplit: true,
    maxLinesPerChunk: 50,
};
import { chunkDocumentImpl } from "./chunker-core.js";
import { findSplitEnd, clamp, countLines, SENTENCE_ENDING } from "./chunker-split.js";
export { findSplitEnd, clamp, countLines, SENTENCE_ENDING };
// CJK Unicode ranges
const CJK_RE = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
function getCjkRatio(text) {
    let cjk = 0;
    let total = 0;
    for (const ch of text) {
        if (/\s/.test(ch))
            continue;
        total++;
        if (CJK_RE.test(ch))
            cjk++;
    }
    return total === 0 ? 0 : cjk / total;
}
const CJK_CHAR_TOKEN_DIVISOR = 2.5;
const CJK_RATIO_THRESHOLD = 0.3;
export function chunkDocument(text, config = DEFAULT_CHUNKER_CONFIG) {
    return chunkDocumentImpl(text, config);
}
export function smartChunk(text, targetLimit = 8192) {
    const cjkHeavy = getCjkRatio(text) > CJK_RATIO_THRESHOLD;
    const divisor = cjkHeavy ? CJK_CHAR_TOKEN_DIVISOR : 1;
    const config = {
        maxChunkSize: Math.max(200, Math.floor((targetLimit * 0.7) / divisor)),
        overlapSize: Math.max(0, Math.floor((targetLimit * 0.05) / divisor)),
        minChunkSize: Math.max(100, Math.floor((targetLimit * 0.1) / divisor)),
        semanticSplit: true,
        maxLinesPerChunk: 50,
    };
    return chunkDocumentImpl(text, config);
}
