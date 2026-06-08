/**
 * hooks/capture-event.ts — Agent-end event processing pipeline.
 *
 * Extracts, filters, evaluates, and builds a capture entry from an agent_end event.
 * Returns null if the event should not be captured.
 * Pure function — all dependencies passed as parameters.
 */
import { appendSelfImprovementEntry } from "../utils/self-improvement.js";
import { compressTexts } from "../utils/session-compressor.js";
import { shouldCaptureTurn, trackSessionActivity, getCaptureConfig, buildCaptureContext, estimateConversation, shouldSkipContent, handleMermaidOffload, runAntiHallucination, buildMetaObj, evaluateWatermark, } from "./capture-barrel.js";
/** Build a skip result (reused for multiple early-exit points). */
function skipResult(sessionKey, date, timestamp, userContent = '', asstContent = '', indexableAsst = '', reason = '') {
    return {
        shouldCapture: false,
        sessionKey,
        date,
        timestamp,
        userContent,
        asstContent,
        indexableAsst,
        entry: '',
        skipReason: reason,
    };
}
/** Process an agent_end event and return capture data, or null if error. */
export async function processCaptureEvent(event, ctx, config, api, store, verifyActive, scopeManager, agentId, llmClient, audit, dedupEngine, db, embedding, skipLocalIndexing) {
    try {
        const e = event;
        const messages = (e.messages ?? []);
        if (!e.success)
            return null;
        const sessionKey = ctx.sessionKey || 'default';
        const capCfg = getCaptureConfig(config);
        // Filter: should we capture this turn?
        const filterResult = shouldCaptureTurn({ sessionKey, messages, agentId }, config);
        if (!filterResult.shouldCapture) {
            api.logger.debug?.(`[yaoyao-memory:capture] ${filterResult.skipReason}`);
            return skipResult(sessionKey, '', '', '', '', '', filterResult.skipReason);
        }
        const activity = trackSessionActivity(sessionKey, config);
        if (activity.shouldLogResume)
            api.logger.debug?.(`[yaoyao-memory:capture] Session ${sessionKey} resumed`);
        // Date / timestamp
        let date;
        if (config.tz) {
            try {
                date = new Intl.DateTimeFormat('sv-SE', { timeZone: config.tz }).format(new Date());
            }
            catch {
                date = new Date().toISOString().slice(0, 10);
            }
        }
        else {
            date = new Date().toISOString().slice(0, 10);
        }
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        // Build capture context
        const cctx = buildCaptureContext(messages, date, timestamp, capCfg.captureMaxLen);
        if (!cctx)
            return null;
        // Conversation value estimate
        const { convValue, texts } = estimateConversation(messages, capCfg.captureMaxLen);
        if (convValue < 0.2 && texts.length > 4)
            api.logger.debug?.('[yaoyao-memory:capture] Low conversation value');
        if (texts.length > 6)
            compressTexts(texts, capCfg.captureMaxLen * 3, { minTexts: 3, minScoreToKeep: 0.3 });
        // Watermark check
        const watermark = evaluateWatermark(messages, config);
        if (watermark.level !== 'none') {
            api.logger.info?.(`[yaoyao-memory:capture] Watermark ${watermark.level} (${(watermark.ratio * 100).toFixed(1)}%)`);
            if (watermark.level === 'emergency')
                api.logger.warn?.('[yaoyao-memory:capture] Emergency — skipping FTS5/L1');
        }
        // Skip check
        const skipCheck = shouldSkipContent(cctx.userContent, cctx.asstContent);
        if (skipCheck.skip) {
            audit?.write({
                component: 'auto-capture',
                event: `skipped-${skipCheck.reason}`,
                summary: `Skipped: ${skipCheck.reason}`,
                details: { sessionKey },
            });
            return skipResult(sessionKey, date, timestamp, cctx.userContent, cctx.asstContent, cctx.indexableAsst, skipCheck.reason);
        }
        // Anti-hallucination
        const { riskTag, specCheck, corrCheck } = runAntiHallucination(cctx.userContent, cctx.indexableAsst, verifyActive);
        handleMermaidOffload(store, sessionKey, cctx.userContent + '\n' + cctx.asstContent, capCfg.enableOffload, capCfg.offloadThreshold);
        // Meta object
        const { meta } = await buildMetaObj(cctx.userContent, cctx.indexableAsst, scopeManager, agentId, specCheck, corrCheck, skipLocalIndexing ? false : capCfg.enableL1, watermark.skipL1 || false, capCfg.brainMode, llmClient, api.logger, capCfg.maxMemoriesPerSession, config);
        // Dedup
        const dedupResult = await dedupEngine.check((cctx.userContent + ' ' + cctx.indexableAsst).trim(), db, embedding, agentId);
        if (dedupResult.isDuplicate) {
            api.logger.debug?.(`[yaoyao-memory:capture] Duplicate (stage=${dedupResult.stage}, conf=${dedupResult.confidence.toFixed(3)}): ${dedupResult.reason}`);
            return skipResult(sessionKey, date, timestamp, cctx.userContent, cctx.asstContent, cctx.indexableAsst, 'duplicate');
        }
        // Build L0 markdown entry
        const entry = `\n### ${timestamp}\n**User:** ${cctx.userContent}${corrCheck.isCorrection ? ' [纠正]' : ''}\n**AI:** ${cctx.asstContent}${riskTag}\n`;
        return {
            shouldCapture: true,
            sessionKey,
            date,
            timestamp,
            userContent: cctx.userContent,
            asstContent: cctx.indexableAsst,
            indexableAsst: cctx.indexableAsst,
            entry,
            meta,
        };
    }
    catch (e2) {
        const errMsg = e2 instanceof Error ? e2.message : String(e2);
        api.logger.error?.(`[yaoyao-memory:capture] Error: ${errMsg}`);
        try {
            appendSelfImprovementEntry({
                baseDir: config.memoryDir || '.',
                type: 'error',
                summary: `Capture failed: ${errMsg.slice(0, 100)}`,
                details: e2 instanceof Error ? e2.stack || errMsg : errMsg,
                area: 'capture',
                source: 'yaoyao-memory/auto-capture',
            }).catch(() => { });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:capture] Persist failed: ${msg}`);
        }
        return null;
    }
}
