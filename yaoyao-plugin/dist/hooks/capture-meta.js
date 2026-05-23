/**
 * hooks/capture-meta.ts — Metadata building + dedup for capture pipeline.
 *
 * Extracted from capture-pipeline.ts to keep it under 200 lines.
 * This module handles the heavy imports: temporal, verify, identity,
 * upgrader, L1 extraction, chunker, memory-types.
 */
import { classifyTemporal, inferExpiry } from "../utils/temporal-classifier.js";
import { detectSpeculative, detectCorrection } from "../core/verify/verify.js";
import { extractIdentityCandidates } from "../utils/identity-addressing.js";
import { enrichMetadata } from "../core/upgrader/index.js";
import { extractFacts } from "../utils/l1-extractor.js";
import { classifyMemoryType } from "../core/memory-types.js";
import { isDuplicateOfRecent } from "../utils/batch-dedup.js";
export function runAntiHallucination(userContent, asstContent, verifyActive) {
    let riskTag = "";
    let specCheck = { isSpeculative: false, markers: [], confidence: "high" };
    let corrCheck = { isCorrection: false, markers: [] };
    if (verifyActive) {
        try {
            specCheck = detectSpeculative(asstContent);
            corrCheck = detectCorrection(userContent);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:capture] Meta parse failed: ${msg}`);
        }
    }
    if (specCheck.isSpeculative)
        riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(", ")}]`;
    if (corrCheck.isCorrection)
        riskTag += ` [🚫 用户纠正]`;
    return { riskTag, specCheck, corrCheck };
}
export async function buildMetaObj(userContent, asstContent, scopeManager, agentId, specCheck, corrCheck, enableL1, skipL1, brainMode, llmClient, logger, maxMemories, config) {
    const temporalType = classifyTemporal(userContent + " " + asstContent);
    const expiryAt = temporalType === "dynamic" ? inferExpiry(userContent + " " + asstContent) : undefined;
    const memoryTag = classifyMemoryType(userContent, asstContent);
    const metaObj = { temporal: temporalType, memoryType: memoryTag.type };
    if (scopeManager)
        metaObj.scope = scopeManager.getDefaultScope(agentId);
    const identities = extractIdentityCandidates(userContent + " " + asstContent);
    if (identities.length > 0)
        metaObj.identities = identities;
    if (expiryAt)
        metaObj.expiryAt = expiryAt;
    if (specCheck.isSpeculative) {
        metaObj.speculative = true;
        metaObj.confidence = specCheck.confidence;
    }
    if (corrCheck.isCorrection) {
        metaObj.correction = true;
    }
    if (memoryTag.tags.length > 0) {
        metaObj.tags = memoryTag.tags;
    }
    if (enableL1 && !skipL1) {
        try {
            const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger });
            if (facts.length > 0)
                metaObj.l1Facts = facts.slice(0, maxMemories);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:capture] Watermark eval failed: ${msg}`);
        }
    }
    enrichMetadata(metaObj, userContent + " " + asstContent);
    const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;
    return { metaObj, meta, memoryTag };
}
export function checkDedup(db, texts, config) {
    if (!config.enableDedup)
        return false;
    try {
        const recent = db.getLatestMemory(config.dedupLookback);
        return isDuplicateOfRecent(texts, recent, config.dedupThreshold);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:capture] Anti-hallucination failed: ${msg}`);
        return false;
    }
}
