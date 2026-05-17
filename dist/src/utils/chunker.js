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
// Sentence ending patterns (English + CJK-ish punctuation)
const SENTENCE_ENDING = /[.!?。！？]/;
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function countLines(s) {
    return s.split(/\r\n|\n|\r/).length;
}
function findSplitEnd(text, start, maxEnd, minEnd, config) {
    const safeMinEnd = clamp(minEnd, start + 1, maxEnd);
    const safeMaxEnd = clamp(maxEnd, safeMinEnd, text.length);
    // Respect line limit
    if (config.maxLinesPerChunk > 0) {
        const candidate = text.slice(start, safeMaxEnd);
        if (countLines(candidate) > config.maxLinesPerChunk) {
            let breaks = 0;
            for (let i = start; i < safeMaxEnd; i++) {
                if (text[i] === "\n") {
                    breaks++;
                    if (breaks >= config.maxLinesPerChunk) {
                        return Math.max(i + 1, safeMinEnd);
                    }
                }
            }
        }
    }
    if (config.semanticSplit) {
        // Prefer sentence boundary
        for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
            if (SENTENCE_ENDING.test(text[i])) {
                let j = i + 1;
                while (j < safeMaxEnd && /\s/.test(text[j]))
                    j++;
                return j;
            }
        }
        // Next best: newline boundary
        for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
            if (text[i] === "\n")
                return i + 1;
        }
    }
    // Fallback: whitespace boundary
    for (let i = safeMaxEnd - 1; i >= safeMinEnd; i--) {
        if (/\s/.test(text[i]))
            return i;
    }
    return safeMaxEnd;
}
function sliceTrimWithIndices(text, start, end) {
    const raw = text.slice(start, end);
    const leading = raw.match(/^\s*/)?.[0]?.length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0]?.length ?? 0;
    const chunk = raw.trim();
    const trimmedStart = start + leading;
    const trimmedEnd = end - trailing;
    return {
        chunk,
        meta: {
            startIndex: trimmedStart,
            endIndex: Math.max(trimmedStart, trimmedEnd),
            length: chunk.length,
        },
    };
}
// CJK Unicode ranges
const CJK_RE = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
/** Ratio of CJK characters to total non-whitespace characters. */
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
    if (!text || text.trim().length === 0) {
        return { chunks: [], metadatas: [], totalOriginalLength: 0, chunkCount: 0 };
    }
    const totalOriginalLength = text.length;
    const chunks = [];
    const metadatas = [];
    let pos = 0;
    const maxGuard = Math.max(4, Math.ceil(text.length / Math.max(1, config.maxChunkSize - config.overlapSize)) + 5);
    let guard = 0;
    while (pos < text.length && guard < maxGuard) {
        guard++;
        const remaining = text.length - pos;
        if (remaining <= config.maxChunkSize) {
            const { chunk, meta } = sliceTrimWithIndices(text, pos, text.length);
            if (chunk.length > 0) {
                chunks.push(chunk);
                metadatas.push(meta);
            }
            break;
        }
        const maxEnd = Math.min(pos + config.maxChunkSize, text.length);
        const minEnd = Math.min(pos + config.minChunkSize, maxEnd);
        const end = findSplitEnd(text, pos, maxEnd, minEnd, config);
        const { chunk, meta } = sliceTrimWithIndices(text, pos, end);
        if (chunk.length < config.minChunkSize) {
            const hardEnd = Math.min(pos + config.maxChunkSize, text.length);
            const hard = sliceTrimWithIndices(text, pos, hardEnd);
            if (hard.chunk.length > 0) {
                chunks.push(hard.chunk);
                metadatas.push(hard.meta);
            }
            if (hardEnd >= text.length)
                break;
            pos = Math.max(hardEnd - config.overlapSize, pos + 1);
            continue;
        }
        chunks.push(chunk);
        metadatas.push(meta);
        if (end >= text.length)
            break;
        const nextPos = Math.max(end - config.overlapSize, pos + 1);
        pos = nextPos;
    }
    return {
        chunks,
        metadatas,
        totalOriginalLength,
        chunkCount: chunks.length,
    };
}
/**
 * Smart chunker that adapts to text composition (CJK ratio).
 */
export function smartChunk(text, targetLimit = 8192) {
    const cjkHeavy = getCjkRatio(text) > CJK_RATIO_THRESHOLD;
    const divisor = cjkHeavy ? CJK_CHAR_TOKEN_DIVISOR : 1;
    const config = {
        maxChunkSize: Math.max(200, Math.floor(targetLimit * 0.7 / divisor)),
        overlapSize: Math.max(0, Math.floor(targetLimit * 0.05 / divisor)),
        minChunkSize: Math.max(100, Math.floor(targetLimit * 0.1 / divisor)),
        semanticSplit: true,
        maxLinesPerChunk: 50,
    };
    return chunkDocument(text, config);
}
