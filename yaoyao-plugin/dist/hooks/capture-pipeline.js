/**
 * hooks/capture-pipeline.ts — Capture pipeline steps.
 *
 * Extracted from auto-capture.ts: each step is a pure function
 * that takes a context and returns a result. The orchestrator
 * calls these in sequence.
 */
import { clampNum } from "../utils/clamp.js";
import { getObj, getProp, getBool } from "../utils/config.js";
import { isNoise } from "../core/filter/noise.js";
import { smartChunk } from "../utils/chunker.js";
import { isMMDBlock } from "../utils/mmd-filter.js";
import { isTrivial } from "../core/filter/trivial.js";
import { extractContent } from "./capture-content.js";
import { maybeOffload } from "../utils/mermaid-canvas.js";
import { estimateConversationValue } from "../utils/session-compressor.js";
export function getCaptureConfig(config) {
    const captureCfg = getObj(config, 'capture') || {};
    return {
        captureMaxLen: clampNum(getProp(captureCfg, 'maxContentLen', 500), 500, 50, 5000),
        enableL1: getBool(config, 'capture.enableL1', false),
        enableDedup: getBool(config, 'capture.enableDedup', true),
        dedupThreshold: clampNum(getProp(config, 'capture.dedupThreshold', 0.92), 0.92, 0.7, 0.99),
        dedupLookback: clampNum(getProp(config, 'capture.dedupLookback', 5), 5, 1, 20),
        enableOffload: getBool(config, 'capture.enableContextOffload', false),
        offloadThreshold: clampNum(getProp(config, 'capture.offloadThreshold', 4000), 4000, 1000, 10000),
        maxContentLen: clampNum(getProp(captureCfg, 'maxContentLen', 500), 500, 50, 5000),
        brainMode: getProp(config, 'brainMode', 'lite'),
        maxMemoriesPerSession: clampNum(getProp(config, 'capture.maxMemoriesPerSession', 20), 20, 1, 100),
    };
}
export function buildCaptureContext(messages, date, timestamp, captureMaxLen) {
    const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user');
    const lastAsstMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
    if (!lastUserMsg)
        return null;
    const userContent = extractContent(lastUserMsg, captureMaxLen);
    const asstContent = lastAsstMsg ? extractContent(lastAsstMsg, captureMaxLen) : '(no response)';
    const indexableAsst = !asstContent || asstContent === '(no response)' ? '' : asstContent;
    return {
        sessionKey: '',
        userContent,
        asstContent,
        indexableAsst,
        lastUserMsg,
        lastAsstMsg,
        messages,
        date,
        timestamp,
    };
}
export function estimateConversation(messages, captureMaxLen) {
    const texts = [];
    for (const m of messages) {
        const role = m.role;
        const text = extractContent(m, 200);
        if (text && (role === 'user' || role === 'assistant'))
            texts.push(text);
    }
    const convValue = estimateConversationValue(texts);
    return { convValue, texts };
}
export function shouldSkipContent(userContent, asstContent) {
    if (isNoise(userContent) && isNoise(asstContent))
        return { skip: true, reason: 'noise' };
    if (isMMDBlock(userContent) || isMMDBlock(asstContent))
        return { skip: true, reason: 'MMD block' };
    const trivialCheck = isTrivial(userContent);
    if (trivialCheck.isTrivial)
        return { skip: true, reason: `trivial: ${trivialCheck.reason}` };
    return { skip: false };
}
export function writeDailyFile(store, date, timestamp, userContent, asstContent, riskTag, isCorrection) {
    const entry = `\n### ${timestamp}\n**User:** ${userContent}${isCorrection ? ' [纠正]' : ''}\n**AI:** ${asstContent}${riskTag}\n`;
    store.appendToDaily(date, entry);
}
export function indexToFTS5(db, userContent, indexableAsst, date, meta, watermark, writeQueue) {
    if (watermark.skipFTS5)
        return;
    const CHUNK_THRESHOLD = 4000;
    if (indexableAsst.length > CHUNK_THRESHOLD) {
        const chunkResult = smartChunk(indexableAsst, CHUNK_THRESHOLD);
        for (let i = 0; i < chunkResult.chunks.length; i++) {
            const chunkMeta = {
                ...JSON.parse(meta || '{}'),
                chunkIndex: i + 1,
                totalChunks: chunkResult.chunkCount,
            };
            const chunkMetaStr = Object.keys(chunkMeta).length > 1 ? JSON.stringify(chunkMeta) : undefined;
            if (writeQueue) {
                writeQueue.enqueue({
                    date,
                    timestamp: date,
                    userContent,
                    asstContent: chunkResult.chunks[i],
                    meta: chunkMetaStr,
                });
            }
            else {
                db.indexTurn(userContent, chunkResult.chunks[i], date, chunkMetaStr);
            }
        }
    }
    else {
        if (writeQueue) {
            writeQueue.enqueue({ date, timestamp: date, userContent, asstContent: indexableAsst, meta });
        }
        else {
            db.indexTurn(userContent, indexableAsst, date, meta);
        }
    }
}
export function handleMermaidOffload(store, sk, text, enable, threshold) {
    if (enable)
        maybeOffload(store.baseDir, sk, text, threshold);
}
