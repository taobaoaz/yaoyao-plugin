/**
 * hooks/capture-meta.ts — Metadata building + dedup for capture pipeline.
 *
 * v1.8.0: Added source (channel/device), deviceInteractions, skillSource metadata.
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
        } catch { /* best-effort */ }
    }
    if (specCheck.isSpeculative) riskTag = ` [⚠️ 推测性: ${specCheck.markers.join(", ")}]`;
    if (corrCheck.isCorrection) riskTag += ` [🚫 用户纠正]`;
    return { riskTag, specCheck, corrCheck };
}

export async function buildMetaObj(
    userContent, asstContent, scopeManager, agentId,
    specCheck, corrCheck, enableL1, skipL1, brainMode, llmClient, logger, maxMemories, config,
    extras,
) {
    // v1.8.0: If device interactions include time-sensitive tools, force dynamic temporal
    const hasTimeSensitive = extras?.deviceInteractions?.some(i =>
        ["create_calendar_event", "search_calendar_event", "create_alarm", "modify_alarm", "delete_alarm"].includes(i.tool)
    ) ?? false;

    const combinedText = userContent + " " + asstContent;
    let temporalType = classifyTemporal(combinedText);
    if (hasTimeSensitive && temporalType !== "dynamic") {
        temporalType = "dynamic";
    }

    const expiryAt = temporalType === "dynamic"
        ? (hasTimeSensitive ? _shortExpiry() : inferExpiry(combinedText))
        : undefined;
    const memoryTag = classifyMemoryType(userContent, asstContent);
    const metaObj = { temporal: temporalType, memoryType: memoryTag.type };

    if (scopeManager) metaObj.scope = scopeManager.getDefaultScope(agentId);
    const identities = extractIdentityCandidates(combinedText);
    if (identities.length > 0) metaObj.identities = identities;
    if (expiryAt) metaObj.expiryAt = expiryAt;
    if (specCheck.isSpeculative) { metaObj.speculative = true; metaObj.confidence = specCheck.confidence; }
    if (corrCheck.isCorrection) { metaObj.correction = true; }
    if (memoryTag.tags.length > 0) { metaObj.tags = memoryTag.tags; }

    // v1.8.0: Channel/device source metadata
    if (extras?.channelInfo) {
        const ci = extras.channelInfo;
        const sourceObj = {};
        if (ci.channel !== "unknown") sourceObj.channel = ci.channel;
        if (ci.deviceType !== "unknown") sourceObj.deviceType = ci.deviceType;
        if (Object.keys(sourceObj).length > 0) metaObj.source = sourceObj;
    }

    // v1.8.0: Device interactions (tool calls)
    if (extras?.deviceInteractions && extras.deviceInteractions.length > 0) {
        metaObj.deviceInteractions = extras.deviceInteractions.slice(0, 10);
    }

    // v1.8.0: Skill source
    if (extras?.skillSource) {
        metaObj.skillSource = extras.skillSource;
    }

    if (enableL1 && !skipL1) {
        try {
            const facts = await extractFacts(userContent, asstContent, { brainMode, llmClient, logger });
            if (facts.length > 0) metaObj.l1Facts = facts.slice(0, maxMemories);
        } catch { /* best effort */ }
    }

    enrichMetadata(metaObj, combinedText);
    const meta = Object.keys(metaObj).length > 1 ? JSON.stringify(metaObj) : undefined;
    return { metaObj, meta, memoryTag };
}

function _shortExpiry() {
    const dt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return dt.toISOString();
}

export function checkDedup(db, texts, config) {
    if (!config.enableDedup) return false;
    try {
        const recent = db.getLatestMemory(config.dedupLookback);
        return isDuplicateOfRecent(texts, recent, config.dedupThreshold);
    } catch { return false; }
}