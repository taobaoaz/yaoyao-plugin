/**
 * hooks/auto-capture.ts — Auto-capture orchestrator.
 *
 * Delegates all work to sub-modules:
 *   - capture-coexist.ts   — coexist detection + bridge
 *   - capture-flush.ts     — L0/L1/L2 flush strategy
 *   - capture-event.ts     — agent_end event processing
 *
 * v1.7.2: Split to comply with 200-line limit.
 */
import { DedupEngine } from "../utils/dedup-engine.js";
import { createWriteQueue } from "../utils/write-queue.js";
import { clampNum } from "../utils/clamp.js";
import { createCaptureDebouncer } from "../utils/capture-debouncer.js";
import { createPersistHandlers } from "./persist-handlers.js";
import { createCoexistContext } from "./capture-coexist.js";
import { createFlushHandler } from "./capture-flush.js";
import { processCaptureEvent } from "./capture-event.js";
export { extractContent, safeStringify } from "./capture-content.js";
export function registerCaptureHook(api, store, db, config, verifyActive = true, scopeManager, llmClient, audit, embedding) {
    const captureMode = config.capture?.mode || "async";
    // Coexist detection + bridge
    const { skipLocalIndexing, forwardCapture, clawBridge, logSuffix } = createCoexistContext(config);
    api.logger.info?.(`[yaoyao-memory] auto-capture mode=${captureMode}${embedding ? " + vector" : ""}${logSuffix}`);
    // Persistence layers
    const persist = createPersistHandlers(api, db, store, embedding);
    // L1+L2 async queue (disabled when coexist skips local indexing)
    const writeQueue = (captureMode === "async" && !skipLocalIndexing)
        ? createWriteQueue(persist.flushBatch, api.logger, audit)
        : null;
    // Three-stage dedup: L1 hash → L2 vector → L3 text
    const dedupEngine = new DedupEngine({ enabled: true, vectorThreshold: 0.80, textLookback: 10 });
    // Debouncer: merges rapid captures for same session
    const debounceMs = clampNum(config.capture?.debounceMs ?? 3000, 3000, 500, 30000);
    const captureDebouncer = createCaptureDebouncer({ debounceMs, maxDelayMs: 10000, maxQueueSize: 50 }, createFlushHandler(persist, writeQueue, clawBridge, forwardCapture, api));
    // Hook: fired on every agent turn end
    api.on("agent_end", async (event, ctx) => {
        const agentId = api.agentId;
        const result = await processCaptureEvent(event, ctx, config, api, store, verifyActive, scopeManager, agentId, llmClient, audit, dedupEngine, db, embedding, skipLocalIndexing);
        if (result && result.shouldCapture) {
            captureDebouncer.push({
                sessionKey: result.sessionKey,
                userContent: result.userContent,
                asstContent: result.indexableAsst,
                date: result.date,
                timestamp: result.timestamp,
                meta: result.meta,
                entry: result.entry,
            });
            api.logger.debug?.("[yaoyao-memory:capture] Captured to " + result.date);
        }
    });
    return {
        drain: async () => {
            captureDebouncer.flushNow();
            if (writeQueue)
                await writeQueue.drain();
        },
    };
}
