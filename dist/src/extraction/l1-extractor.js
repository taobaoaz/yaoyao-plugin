import { parseJSONResponse } from "../utils/llm-parse.js";
import { EXTRACT_MEMORIES_SYSTEM_PROMPT, formatExtractionPrompt } from "./prompts.js";
const TAG = "[yaoyao-memory:l1-extractor]";
export async function extractL1Memories(params) {
    const { messages, db, llm, embedding, logger } = params;
    const log = logger || console;
    if (!llm) {
        log.debug?.(`${TAG} No LLM configured, trying rule-based extraction`);
        return ruleBasedExtraction(messages, db, log);
    }
    if (messages.length < 2) {
        log.debug?.(`${TAG} Not enough messages for extraction`);
        return { success: false, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
    }
    const formattedMessages = messages
        .slice(-10)
        .map(m => `[${m.role}]: ${m.content}`)
        .join("\n");
    const prompt = formatExtractionPrompt(formattedMessages);
    try {
        const response = await llm.extract(EXTRACT_MEMORIES_SYSTEM_PROMPT, prompt);
        const scenes = parseJSONResponse(response);
        if (!scenes || scenes.length === 0) {
            log.debug?.(`${TAG} No valid memories extracted`);
            return { success: true, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
        }
        const sceneNames = [];
        let totalExtracted = 0;
        let totalStored = 0;
        const metaRowIds = [];
        for (const scene of scenes) {
            if (scene.scene_name) {
                sceneNames.push(scene.scene_name);
            }
            if (!scene.memories || scene.memories.length === 0)
                continue;
            for (const mem of scene.memories) {
                if (!mem.content || mem.content.length < 5)
                    continue;
                totalExtracted++;
                const typeTag = `[${(mem.type || "info")}]`;
                const priorityTag = `[priority:${mem.priority || 50}]`;
                const taggedContent = `${typeTag} ${priorityTag} ${mem.content}`;
                if (db) {
                    const date = new Date().toISOString().slice(0, 10);
                    const rowId = db.indexTurn(taggedContent, "", date);
                    if (rowId > 0) {
                        totalStored++;
                        metaRowIds.push(rowId);
                        // Best-effort vector storage (fire-and-forget)
                        if (embedding && mem.content.length >= 10) {
                            embedding.embed(mem.content).then(vec => {
                                try {
                                    db.storeVector(rowId, vec);
                                }
                                catch { /* best effort */ }
                            }).catch(() => { });
                        }
                    }
                }
            }
        }
        const lastScene = scenes[scenes.length - 1]?.scene_name;
        log.info?.(`${TAG} Extracted ${totalExtracted} memories, stored ${totalStored}`);
        return {
            success: true,
            extractedCount: totalExtracted,
            storedCount: totalStored,
            metaRowIds,
            sceneNames,
            lastSceneName: lastScene,
        };
    }
    catch (err) {
        log.error?.(`${TAG} Extraction failed: ${err.message}`);
        // Degrade to rule-based extraction
        try {
            return ruleBasedExtraction(messages, db, log);
        } catch {
            return { success: false, extractedCount: 0, storedCount: 0, metaRowIds: [], sceneNames: [] };
        }
    }
}

/** Rule-based extraction fallback when LLM is unavailable */
function ruleBasedExtraction(messages, db, logger) {
    const sceneNames = [];
    let stored = 0;
    const metaRowIds = [];
    for (const m of messages) {
        if (m.role !== "user" || !m.content) continue;
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (text.length < 50) continue;
        const hasDecision = ["决定", "选择", "方案", "确认", "agree", "decide", "confirm", "plan"].some(k => text.toLowerCase().includes(k));
        if (hasDecision && db) {
            const date = new Date().toISOString().slice(0, 10);
            const rowId = db.indexTurn(`[rule-extracted] ${text.slice(0, 200)}`, "", date);
            if (rowId > 0) {
                stored++;
                metaRowIds.push(rowId);
            }
        }
    }
    if (stored > 0) {
        logger.info?.(`${TAG} Rule-based extraction: ${stored} memories stored (LLM fallback)`);
    }
    return { success: stored > 0, extractedCount: stored, storedCount: stored, metaRowIds, sceneNames };
}
