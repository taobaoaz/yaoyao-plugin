import { extractL1Memories } from "../extraction/l1-extractor.js";
import { runSceneExtraction } from "../scenes/scene-extractor.js";
import { generateOrUpdatePersona } from "../persona/persona-generator.js";
import path from "node:path";
import fs from "node:fs";
const TAG = "[yaoyao-memory:pipeline]";
// ── In-memory throttle: prevent same-session cascade ──
const throttleMap = new Map();
const THROTTLE_CLEANUP_INTERVAL = 60_000; // cleanup stale entries every 60s
let lastThrottleCleanup = Date.now();
function cleanupThrottleMap() {
    const now = Date.now();
    if (now - lastThrottleCleanup < THROTTLE_CLEANUP_INTERVAL)
        return;
    lastThrottleCleanup = now;
    const cutoff = now - 5000; // keep entries from the last 5 seconds
    for (const [key, ts] of throttleMap) {
        if (ts < cutoff)
            throttleMap.delete(key);
    }
}
export function registerPipelineManager(api, store, db, llm, config, embedding) {
    api.logger.info(`${TAG} Registering L1→L2→L3 pipeline manager`);
    // Ensure checkpoint dir exists
    const checkpointDir = path.join(store.baseDir, ".pipeline");
    fs.mkdirSync(checkpointDir, { recursive: true });
    /**
     * Read checkpoint from file (persisted across restarts)
     */
    function readCheckpoint(sessionKey) {
        try {
            const fp = path.join(checkpointDir, `${sanitizeKey(sessionKey)}.json`);
            if (!fs.existsSync(fp))
                return null;
            return JSON.parse(fs.readFileSync(fp, "utf-8"));
        }
        catch {
            return null;
        }
    }
    /**
     * Save checkpoint to file
     */
    function saveCheckpoint(cp) {
        try {
            const fp = path.join(checkpointDir, `${sanitizeKey(cp.sessionKey)}.json`);
            fs.writeFileSync(fp, JSON.stringify(cp), "utf-8");
        }
        catch { /* best effort */ }
    }
    /**
     * Sanitize session key for filesystem safety
     */
    function sanitizeKey(key) {
        return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
    }
    // Register on agent_end to run extraction pipeline
    api.on("agent_end", async (event, ctx) => {
        try {
            const e = event;
            if (!e.success)
                return;
            const messages = e.messages ?? [];
            if (messages.length < 2)
                return;
            const sessionKey = ctx.sessionKey || "default";
            // ── Throttle: skip if this session was processed < 1s ago ──
            const now = Date.now();
            cleanupThrottleMap();
            const lastRun = throttleMap.get(sessionKey) || 0;
            if (now - lastRun < 1000)
                return;
            throttleMap.set(sessionKey, now);
            // ── Persistent checkpoint ──
            const cp = readCheckpoint(sessionKey);
            if (cp && messages.length <= cp.messageCount)
                return;
            // === L1: Extract structured memories ===
            const l1Result = await extractL1Memories({
                messages: messages.slice(-5),
                sessionKey,
                db,
                config,
                llm,
                embedding,
                logger: api.logger,
            });
            if (l1Result.success && l1Result.storedCount > 0) {
                api.logger.info(`${TAG} L1 extraction: ${l1Result.storedCount} memories stored`);
                // Vector storage is handled inside extractL1Memories (fire-and-forget via embedding param)
                // ── Cumulative counter: grows monotonically across sessions ──
                const prevCount = cp?.extractionCount || 0;
                const nextCount = prevCount + l1Result.storedCount;
                // Check if we crossed a 10-boundary (10, 20, 30…) → run L2
                const prevL2Block = Math.floor(prevCount / 10);
                const nextL2Block = Math.floor(nextCount / 10);
                if (nextL2Block > prevL2Block) {
                    const memoriesForScene = l1Result.sceneNames.map(name => ({
                        content: name,
                        date: new Date().toISOString().slice(0, 10),
                    }));
                    const l2Result = await runSceneExtraction({
                        memories: memoriesForScene,
                        llm,
                        memoryDir: store.baseDir,
                        logger: api.logger,
                    });
                    if (l2Result.success) {
                        api.logger.info(`${TAG} L2 scene extraction: ${l2Result.sceneCount} scenes`);
                        // Check if we crossed a 20-boundary → run L3
                        const prevL3Block = Math.floor(prevCount / 20);
                        const nextL3Block = Math.floor(nextCount / 20);
                        if (nextL3Block > prevL3Block) {
                            const l3Result = await generateOrUpdatePersona({
                                memories: l1Result.sceneNames,
                                existingPersona: null, // persona.md is markdown, not JSON — re-generate each time
                                llm,
                                memoryDir: store.baseDir,
                                logger: api.logger,
                            });
                            if (l3Result.success) {
                                api.logger.info(`${TAG} L3 persona: updated`);
                            }
                        }
                    }
                }
                else {
                    api.logger.debug?.(`${TAG} Next L2 at count ${(prevL2Block + 1) * 10} (current: ${nextCount})`);
                }
                // Save persistent checkpoint (cumulative, never resets)
                saveCheckpoint({
                    sessionKey,
                    messageCount: messages.length,
                    extractionCount: nextCount,
                    l3Complete: false,
                    updatedAt: new Date().toISOString(),
                });
            }
        }
        catch (err) {
            api.logger.error(`${TAG} Pipeline error: ${err.message}`);
            // Don't crash the plugin
        }
    });
}
